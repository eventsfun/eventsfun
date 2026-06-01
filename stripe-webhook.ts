import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const event = JSON.parse(body);
    console.log("Evento Stripe ricevuto:", event.type);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ================================================================
    // GESTIONE SCADENZA ABBONAMENTO AGENZIA
    // ================================================================

    if (event.type === "customer.subscription.deleted") {
      // Abbonamento cancellato o non rinnovato -- blocco soft dopo grace period
      const sub = event.data.object;
      const subscriptionId = sub.id;
      const canceledAt = sub.canceled_at
        ? new Date(sub.canceled_at * 1000).toISOString()
        : new Date().toISOString();

      console.log("Abbonamento cancellato:", subscriptionId);

      // Trova l'ordine tramite subscription_id
      const { data: order } = await supabase
        .from("orders")
        .select("id, email, nome")
        .eq("subscription_id", subscriptionId)
        .single();

      if (order) {
        // Grace period 7 giorni: expires_at = now + 7 giorni
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await supabase
          .from("orders")
          .update({
            subscription_status: "canceled",
            subscription_expires_at: expiresAt.toISOString(),
          })
          .eq("id", order.id);

        console.log("Ordine aggiornato a canceled, scade:", expiresAt.toISOString());

        // Manda email di avviso al cliente
        const resendKey = Deno.env.get("RESEND_API_KEY")!;
        const expiresStr = expiresAt.toLocaleDateString("it-IT", {
          day: "numeric", month: "long", year: "numeric"
        });
        const emailHtml = `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#0A0A0A;padding:28px 32px">
      <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:#F5F0E8">Events<span style="color:#C9A96E">Fun</span></span>
    </div>
    <div style="padding:32px">
      <h2 style="color:#1a1a1a;margin:0 0 8px">Il tuo abbonamento Agenzia &egrave; stato cancellato</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 20px">
        Ciao ${order.nome || ""}! Il tuo abbonamento EventsFun Agenzia &egrave; stato cancellato.<br>
        Potrai continuare ad accedere alla dashboard fino al <strong>${expiresStr}</strong>.
      </p>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">
        Vuoi riattivare il tuo abbonamento? Puoi farlo in qualsiasi momento dalla tua area personale.
      </p>
      <a href="https://eventsfun.com/area-personale.html" style="display:inline-block;padding:14px 28px;background:#C9A96E;color:#0A0A0A;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">
        Vai all'area personale
      </a>
      <p style="color:#999;font-size:12px;margin:24px 0 0;line-height:1.6">
        Per assistenza: <a href="mailto:info@eventsfun.com" style="color:#C9A96E">info@eventsfun.com</a>
      </p>
    </div>
    <div style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eee">
      <p style="color:#bbb;font-size:11px;margin:0;text-align:center">2026 EventsFun -- eventsfun.com</p>
    </div>
  </div>
</body>
</html>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "EventsFun <info@eventsfun.com>",
            to: [order.email],
            subject: "Il tuo abbonamento EventsFun Agenzia e stato cancellato",
            html: emailHtml,
          }),
        });

        console.log("Email cancellazione inviata a:", order.email);
      } else {
        console.warn("Ordine non trovato per subscription_id:", subscriptionId);
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.type === "invoice.payment_failed") {
      // Pagamento fallito -- segnala ma non blocca ancora (Stripe riprova automaticamente)
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      console.log("Pagamento fallito per subscription:", subscriptionId);

      if (subscriptionId) {
        await supabase
          .from("orders")
          .update({ subscription_status: "past_due" })
          .eq("subscription_id", subscriptionId);

        // Manda email di avviso pagamento fallito
        const { data: order } = await supabase
          .from("orders")
          .select("email, nome")
          .eq("subscription_id", subscriptionId)
          .single();

        if (order) {
          const resendKey = Deno.env.get("RESEND_API_KEY")!;
          const emailHtml = `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#0A0A0A;padding:28px 32px">
      <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:#F5F0E8">Events<span style="color:#C9A96E">Fun</span></span>
    </div>
    <div style="padding:32px">
      <h2 style="color:#1a1a1a;margin:0 0 8px">Problema con il pagamento del tuo abbonamento</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 20px">
        Ciao ${order.nome || ""}! Non &egrave; stato possibile rinnovare il tuo abbonamento EventsFun Agenzia.<br>
        Riproveremo automaticamente nei prossimi giorni.
      </p>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">
        Per evitare interruzioni del servizio, aggiorna il tuo metodo di pagamento.
      </p>
      <a href="https://billing.stripe.com/p/login/bJe6ozfIO0gE9EkcKE14400" style="display:inline-block;padding:14px 28px;background:#C9A96E;color:#0A0A0A;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">
        Aggiorna metodo di pagamento
      </a>
      <p style="color:#999;font-size:12px;margin:24px 0 0;line-height:1.6">
        Per assistenza: <a href="mailto:info@eventsfun.com" style="color:#C9A96E">info@eventsfun.com</a>
      </p>
    </div>
    <div style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eee">
      <p style="color:#bbb;font-size:11px;margin:0;text-align:center">2026 EventsFun -- eventsfun.com</p>
    </div>
  </div>
</body>
</html>`;

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "EventsFun <info@eventsfun.com>",
              to: [order.email],
              subject: "Problema con il pagamento -- EventsFun Agenzia",
              html: emailHtml,
            }),
          });
          console.log("Email pagamento fallito inviata a:", order.email);
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ================================================================
    // GESTIONE NUOVO ACQUISTO (logica esistente)
    // ================================================================

    if (event.type !== "checkout.session.completed" &&
        event.type !== "payment_intent.succeeded") {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = event.data.object;
    const metadata = session.metadata || {};

    // Mappa price_id -> piano (infallibile anche con coupon/sconti a euro 0)
    const PRICE_MAP: Record<string, string> = {
      "price_1Tc7yB0zA2w5BrZSOQdSrtgS": "base",     // Base 29euro
      "price_1Tc81k0zA2w5BrZShi1wuE29": "pro",      // Pro 79euro
      "price_11c84B0zA2w5BrZSSuR7r2h8": "agenzia",  // Agenzia mensile 69euro
      "price_1Tc85W0zA2w5BrZS1sHkTMRJ": "agenzia",  // Agenzia annuale 588euro
    };

    // Estrae price_id -- i line_items non sono inclusi nel payload webhook,
    // vanno recuperati via API Stripe. Per le subscription usiamo il sub ID.
    let priceId: string = metadata.price_id || "";

    if (!priceId && session.subscription) {
      // Subscription: recupera i line items dalla subscription
      try {
        const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")!;
        const subRes = await fetch(
          "https://api.stripe.com/v1/subscriptions/" + session.subscription + "?expand[]=items.data.price",
          { headers: { "Authorization": "Bearer " + stripeSecret } }
        );
        if (subRes.ok) {
          const sub = await subRes.json();
          priceId = sub.items?.data?.[0]?.price?.id || "";
        }
      } catch(e) {
        console.warn("Impossibile recuperare price_id dalla subscription:", e);
      }
    }

    if (!priceId && session.payment_intent) {
      // Pagamento singolo: recupera i line items dalla sessione
      try {
        const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY")!;
        const sessRes = await fetch(
          "https://api.stripe.com/v1/checkout/sessions/" + session.id + "/line_items",
          { headers: { "Authorization": "Bearer " + stripeSecret } }
        );
        if (sessRes.ok) {
          const li = await sessRes.json();
          priceId = li.data?.[0]?.price?.id || "";
        }
      } catch(e) {
        console.warn("Impossibile recuperare price_id dalla sessione:", e);
      }
    }

    let piano: string = metadata.piano || PRICE_MAP[priceId] || "";

    const importo = session.amount_total || 0;

    // Fallback su importo solo se non abbiamo ancora il piano
    if (!piano) {
      if (importo >= 7900) piano = "pro";
      else if (importo >= 6900) piano = "agenzia";
      else piano = "base";
    }

    console.log("Piano rilevato:", piano, "| price_id:", priceId, "| importo:", importo);

    const email = session.customer_details?.email || session.customer_email || metadata.email || "";
    const nomeCompleto = session.customer_details?.name || metadata.nome || "";
    const nomeParts = nomeCompleto.trim().split(" ");
    const nome = nomeParts[0] || "";
    const cognome = nomeParts.slice(1).join(" ") || "";
    const newsletter = metadata.newsletter === "true";
    const stripeId = session.id || session.payment_intent || "";

    console.log("Dati estratti:", { email, nome, cognome, piano, importo });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Evita doppioni
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_id", stripeId)
      .single();

    if (existing) {
      console.log("Ordine gia processato:", stripeId);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Crea ordine
    const subscriptionId = session.subscription || null;
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        email, nome, cognome, piano, stripe_id: stripeId, importo, newsletter,
        subscription_id: subscriptionId,
        subscription_status: subscriptionId ? "active" : null,
      })
      .select()
      .single();

    if (orderError) throw orderError;
    console.log("Ordine creato:", order.id);

    // 2. Crea token attivazione (3 token per piano agenzia, 1 per gli altri)
    const numTokens = piano === "agenzia" ? 3 : 1;
    const tokens: string[] = [];
    for (let i = 0; i < numTokens; i++) {
      const token = crypto.randomUUID();
      const { error: activationError } = await supabase
        .from("activations")
        .insert({ order_id: order.id, token, stato: "pending" });
      if (activationError) throw activationError;
      tokens.push(token);
    }
    const token = tokens[0]; // token principale (usato per il link email)
    console.log("Token creati:", numTokens, tokens);

    // 3. Crea utente Supabase Auth (se non esiste gia)
    //    L'utente viene creato gia confermato; la password la imposta lui dal link.
    let userExists = false;
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: email,
      email_confirm: true,
      user_metadata: { nome, cognome },
    });

    if (createUserError) {
      // Se l'utente esiste gia (ha gia comprato in passato), non e un errore bloccante
      const msg = (createUserError.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        userExists = true;
        console.log("Utente Auth gia esistente:", email);
      } else {
        console.error("Errore creazione utente Auth:", createUserError.message);
      }
    } else {
      console.log("Utente Auth creato:", createdUser?.user?.id);
    }

    // 4. Genera link per impostare la password
    //    - Nuovo utente: link tipo "invite/recovery" per impostare la prima password
    //    - Utente esistente: gli mandiamo comunque un recovery, ma puo anche usare la password che ha gia
    const redirectTo = "https://eventsfun.com/imposta-password.html";
    let actionLink = "";

    const linkType = userExists ? "recovery" : "recovery";
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: linkType,
      email: email,
      options: { redirectTo },
    });

    if (linkError) {
      console.error("Errore generazione link password:", linkError.message);
    } else {
      actionLink = linkData?.properties?.action_link || "";
      console.log("Link password generato");
    }

    // 5. Invia email
    const pianoLabel = piano === "base" ? "Evento Base" : piano === "pro" ? "Evento Pro" : "Agenzia";
    const areaUrl = "https://eventsfun.com/area-personale.html";

    // Se per qualche motivo il link non e stato generato, fallback all'area personale
    const ctaUrl = actionLink || areaUrl;
    const ctaLabel = userExists ? "Imposta una nuova password" : "Imposta la tua password";
    const introText = userExists
      ? `Hai gia un account EventsFun. Il tuo nuovo pacchetto <strong>${pianoLabel}</strong> e attivo.<br>Puoi accedere con la password che hai gia, oppure impostarne una nuova qui sotto.`
      : `Il tuo pacchetto <strong>${pianoLabel}</strong> e attivo.<br>Imposta la tua password per accedere all'area personale e gestire i tuoi eventi da qualsiasi dispositivo.`;

    // Sezione extra per il piano Agenzia: mostra i 3 link dashboard
    let agenziaLinksHtml = "";
    if (piano === "agenzia" && tokens.length === 3) {
      agenziaLinksHtml = `
      <div style="margin:24px 0;padding:18px 20px;background:#f9f9f9;border:1px solid #eee;border-radius:10px">
        <p style="font-size:13px;font-weight:700;color:#1a1a1a;margin:0 0 12px">I tuoi 3 accessi dashboard Agenzia</p>
        <p style="font-size:12px;color:#777;margin:0 0 14px;line-height:1.6">Ogni link e indipendente e puo essere usato da un collaboratore diverso. Conservali con cura.</p>
        ${tokens.map((t, i) => `
        <div style="margin-bottom:10px">
          <span style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px">Account ${i + 1}</span><br>
          <a href="https://eventsfun.com/agenzia-dashboard.html?token=${t}" style="font-size:12px;color:#C9A96E;word-break:break-all">
            eventsfun.com/agenzia-dashboard.html?token=${t}
          </a>
        </div>`).join("")}
      </div>`;
    }

    const emailHtml = `<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#0A0A0A;padding:28px 32px">
      <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:#F5F0E8">Events<span style="color:#C9A96E">Fun</span></span>
    </div>
    <div style="padding:32px">
      <h2 style="color:#1a1a1a;margin:0 0 8px">Grazie per il tuo acquisto, ${nome || ""}!</h2>
      <p style="color:#555;line-height:1.7;margin:0 0 24px">
        ${introText}
      </p>
      <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;background:#C9A96E;color:#0A0A0A;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">
        ${ctaLabel}
      </a>
      ${agenziaLinksHtml}
      <p style="color:#999;font-size:12px;margin:24px 0 0;line-height:1.6">
        Dopo aver impostato la password, accedi sempre da<br>
        <a href="${areaUrl}" style="color:#C9A96E">eventsfun.com/area-personale.html</a> con la tua email e password.<br><br>
        Per assistenza: <a href="mailto:info@eventsfun.com" style="color:#C9A96E">info@eventsfun.com</a>
      </p>
    </div>
    <div style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eee">
      <p style="color:#bbb;font-size:11px;margin:0;text-align:center">2026 EventsFun - eventsfun.com</p>
    </div>
  </div>
</body>
</html>`;

    const resendKey = Deno.env.get("RESEND_API_KEY")!;
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "EventsFun <info@eventsfun.com>",
        to: [email],
        subject: `Il tuo pacchetto ${pianoLabel} e pronto - EventsFun`,
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.text();
      console.error("Errore invio email:", emailErr);
    } else {
      console.log("Email inviata a:", email);
    }

    return new Response(
      JSON.stringify({ received: true, order_id: order.id, token, tokens, user_existed: userExists }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Errore:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
