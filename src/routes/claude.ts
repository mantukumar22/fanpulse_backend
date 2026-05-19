import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { CallClaudeBody } from "@workspace/api-zod";

const router = Router();

router.post("/claude", async (req, res) => {
  const parsed = CallClaudeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { system, user, max_tokens = 150 } = parsed.data;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: Math.max(max_tokens, 8192),
      system,
      messages: [{ role: "user", content: user }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";
    res.json({ text });
  } catch (err) {
    req.log.error({ err }, "Claude API error");
    res.status(500).json({ error: "Failed to call Claude API" });
  }
});

export default router;
