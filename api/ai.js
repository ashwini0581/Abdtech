// Vercel serverless function: POST /api/ai
// Proxies chat/completion requests to an AI provider using a server-side API key
// (set as an environment variable in Vercel). The browser never sees the key.
//
// Supports three providers, tried in this order:
//   1. GROQ_API_KEY      -> Groq (genuinely free, no card, no billing setup, ever)
//   2. GEMINI_API_KEY    -> Google Gemini (free tier, but may require billing setup on new accounts)
//   3. ANTHROPIC_API_KEY -> Claude (small one-time free trial credit, then paid)
//
// All are normalized to the same response shape the frontend expects:
//   { content: [{ text: "..." }] }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { system, messages, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "Request body must include a non-empty 'messages' array." });
    return;
  }

  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!groqKey && !geminiKey && !anthropicKey) {
    res.status(500).json({
      error: "No AI key configured. Add GROQ_API_KEY (free, no card, console.groq.com), GEMINI_API_KEY (aistudio.google.com), or ANTHROPIC_API_KEY under Vercel Project Settings > Environment Variables, then redeploy.",
    });
    return;
  }

  try {
    if (groqKey) {
      const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
      const chatMessages = [
        ...(system ? [{ role: "system", content: system }] : []),
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({
          model,
          messages: chatMessages,
          max_tokens: Math.min(Number(max_tokens) || 1000, 4096),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        res.status(r.status).json({ error: data?.error?.message || "Groq API request failed", detail: data });
        return;
      }
      const text = data?.choices?.[0]?.message?.content || "";
      res.status(200).json({ content: [{ text }] });
      return;
    }

    if (geminiKey) {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const contents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      const body = {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: Math.min(Number(max_tokens) || 1000, 4096) },
      };
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      const data = await r.json();
      if (!r.ok) {
        res.status(r.status).json({ error: data?.error?.message || "Gemini API request failed", detail: data });
        return;
      }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
      res.status(200).json({ content: [{ text }] });
      return;
    }

    // Fallback: Anthropic
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: Math.min(Number(max_tokens) || 1000, 4096),
        ...(system ? { system } : {}),
        messages,
      }),
    });
    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      res.status(anthropicRes.status).json({ error: data?.error?.message || "Anthropic API request failed", detail: data });
      return;
    }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: "Server error calling AI provider: " + e.message });
  }
    }
