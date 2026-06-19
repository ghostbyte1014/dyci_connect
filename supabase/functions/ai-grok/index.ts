import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req) => {
  // Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    // 1. Extract and Validate Supabase Authorization Bearer Token
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Unauthorized: Missing Authorization header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return json(500, { error: "Supabase internal environment configuration missing" });
    }

    // Authenticate user
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);

    if (authError || !authData.user) {
      console.error("Auth Error:", authError);
      return json(401, { error: "Unauthorized: Invalid session" });
    }

    // 2. Load Grok Secrets
    const GROK_API_URL = Deno.env.get("GROK_API_URL") || "https://api.groq.com/openai/v1/chat/completions";
    const GROK_API_KEY = Deno.env.get("GROK_API_KEY");
    const GROK_MODEL = Deno.env.get("GROK_MODEL") || "groq/compound-mini";

    if (!GROK_API_KEY) {
      console.error("GROK_API_KEY secret is missing in Supabase.");
      return json(500, { error: "GROK_API_KEY secret is not configured in Supabase dashboard." });
    }

    // 3. Parse Input Payload
    const body = await req.json();
    const { action, payload } = body;

    if (!action) {
      return json(400, { error: "Action parameter is required." });
    }

    // 4. Construct Grok Messages and Options Based on Action
    let messages: Array<{ role: string; content: string }> = [];
    let temperature = 0.5;
    let maxTokens = 1024;
    let compoundCustom: any = undefined;

    if (action === "generate-keywords") {
      const { title, body: contentBody } = payload || {};
      if (!title || !contentBody) {
        return json(400, { error: "Title and body are required for generate-keywords" });
      }

      messages = [
        {
          role: "system",
          content: `Extract 3-6 single-word keywords for a school support bot. 

STRICT RULES:
1. Each keyword MUST be exactly ONE word (no spaces, no phrases)
2. Keywords should be 3-15 characters long
3. Use common search terms students would type
4. Examples of GOOD keywords: "scholarship", "enrollment", "tuition", "grade", "exam", "drop"
5. Examples of BAD keywords: "scholarship program", "how to enroll", "grade requirements"

Return ONLY a JSON object: {"keywords": ["word1", "word2", "word3"]}. No markdown.`,
        },
        { role: "user", content: `Section Title: ${title}\nSection Content: ${contentBody}` },
      ];
      temperature = 0.3;
      maxTokens = 256;
    } else if (action === "summarized-response") {
      const { question, sourceData, sourceLabel, keywords = [] } = payload || {};
      if (!question || !sourceData) {
        return json(400, { error: "Question and sourceData are required for summarized-response" });
      }

      messages = [
        {
          role: "system",
          content: `You are the DYCI Assistant. You have been given specific school data to answer a student question. 

IMPORTANT RULES:
1. Answer using ONLY the provided source data below.
2. DO NOT search the web or use any external information.
3. Synthesize information from multiple sources if needed.
4. If the source data doesn't fully answer the question, acknowledge what you found and suggest the user ask for more details.
5. Be professional, concise, and helpful.
6. When presenting lists, core values, rules, steps, or hierarchical options, structure them beautifully using clear bullet points, bold titles/sub-headers, and line breaks.
7. When citing information, mention the SECTION TITLE in parentheses, e.g., "(from Enrollment Procedures)" or "(Student Organizations section)".
8. DO NOT use citation numbers like [1], [2], etc.

Source: ${sourceLabel || "School Information"}
Matched Keywords: ${(keywords || []).join(", ")}`,
        },
        { role: "user", content: `Student Question: ${question}\n\nSource Data:\n${sourceData}` },
      ];
      temperature = 0.3;
      maxTokens = 512;
    } else if (action === "ai-response") {
      const { content } = payload || {};
      if (!content) {
        return json(400, { error: "Content is required for ai-response" });
      }

      messages = [
        {
          role: "system",
          content:
            "You are the DYCI Assistant. Answer student questions based on the school handbook. If you don't know the answer, use your tools (web search, etc.) to double-check or say \"I'm not sure about that. Let me connect you to a staff member.\" Keep it professional and concise.",
        },
        { role: "user", content },
      ];
      temperature = 0.5;
      maxTokens = 1024;
      compoundCustom = {
        tools: {
          enabled_tools: ["web_search", "code_interpreter", "visit_website"],
        },
      };
    } else {
      return json(400, { error: `Unsupported action: ${action}` });
    }

    // 5. Call Grok AI
    const grokBody: Record<string, any> = {
      model: GROK_MODEL,
      messages: messages,
      temperature: temperature,
      max_completion_tokens: maxTokens,
    };

    if (compoundCustom) {
      grokBody.compound_custom = compoundCustom;
    }

    console.log(`Forwarding execution to Grok (${GROK_MODEL}) for action: ${action}...`);

    const response = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify(grokBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Grok API Error Response:", errorText);
      return json(response.status, { error: "Grok API reported an error", details: errorText });
    }

    const data = await response.json();
    const replyContent = data.choices?.[0]?.message?.content || "";

    return json(200, { content: replyContent });
  } catch (error: any) {
    console.error("Edge function error:", error);
    return json(500, { error: "Internal server error", details: error.message });
  }
});
