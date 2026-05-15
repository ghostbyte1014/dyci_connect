import { supabase } from '../lib/supabaseClient';

const GROK_API_URL = import.meta.env.VITE_GROK_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROK_API_KEY = import.meta.env.VITE_GROK_API_KEY;
const GROK_MODEL = import.meta.env.VITE_GROK_MODEL || 'groq/compound-mini';

export const normalizeMessage = (content: string): string => {
  return content
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/gi, '');
};

// Error handling wrapper for Supabase inserts
const safeInsert = async (table: string, payload: any) => {
  try {
    const { error } = await supabase.from(table).insert(payload);
    if (error) {
      console.error(`Error inserting into ${table}:`, error);
      return { error };
    }
    return { error: null };
  } catch (err) {
    console.error(`Fatal error inserting into ${table}:`, err);
    return { error: err };
  }
};

// Extract individual words from message (for single-word keyword matching)
const extractWords = (message: string): string[] => {
  return normalizeMessage(message)
    .split(/\s+/)
    .filter(word => word.length >= 3); // Only words with 3+ chars
};

export interface MatchResult {
  type: 'handbook' | 'calendar';
  data: any[];
  keywords: string[]; // Track which keywords matched
}

export const findMatch = async (message: string): Promise<MatchResult | null> => {
  const words = extractWords(message);
  if (words.length === 0) return null;

  // 1. Get current academic year ID
  let ayId: string | null = null;
  const { data: rpcAyId } = await supabase.rpc('get_current_academic_year_id');
  if (rpcAyId) {
    ayId = rpcAyId;
  } else {
    const { data: years } = await supabase.from('academic_years').select('id, is_current').order('year_name', { ascending: false });
    if (years && years.length > 0) {
      const current = years.find(y => y.is_current);
      ayId = current ? current.id : years[0].id;
    }
  }
  if (!ayId) return null;

  const matchedHandbookSections = new Map<string, any>(); // section_id -> section data
  const matchedCalendarEvents = new Map<string, any>(); // event_id -> event data
  const matchedKeywords: string[] = [];

  // 2. Search Handbook Keywords - Get ALL matching sections
  const { data: handbookData } = await supabase
    .from('handbook_keywords')
    .select(`
      keyword, 
      section_id, 
      handbook_sections!inner(
        id,
        title, 
        content,
        handbooks!inner(status, academic_year_id)
      )
    `)
    .in('keyword', words)
    .eq('handbook_sections.handbooks.status', 'published')
    .eq('handbook_sections.handbooks.academic_year_id', ayId);

  if (handbookData && handbookData.length > 0) {
    handbookData.forEach((item: any) => {
      const section = item.handbook_sections;
      const sectionData = Array.isArray(section) ? section[0] : section;
      if (sectionData) {
        matchedHandbookSections.set(sectionData.id, sectionData);
        if (!matchedKeywords.includes(item.keyword)) {
          matchedKeywords.push(item.keyword);
        }
      }
    });
  }

  // 3. Search Calendar Keywords - Get ALL matching events
  const { data: calData } = await supabase
    .from('calendar_event_keywords')
    .select(`
      keyword,
      event_id,
      calendar_events!inner(*)
    `)
    .in('keyword', words)
    .is('calendar_events.deleted_at', null);

  if (calData && calData.length > 0) {
    calData.forEach((item: any) => {
      const event = item.calendar_events;
      const eventData = Array.isArray(event) ? event[0] : event;
      if (eventData) {
        matchedCalendarEvents.set(eventData.id, eventData);
        if (!matchedKeywords.includes(item.keyword)) {
          matchedKeywords.push(item.keyword);
        }
      }
    });
  }

  // 3b. Search by direct title match fallback
  for (const word of words) {
    const { data: titleData } = await supabase
      .from('calendar_events')
      .select('*')
      .is('deleted_at', null)
      .ilike('title', `%${word}%`);
    if (titleData && titleData.length > 0) {
      titleData.forEach((event: any) => {
        matchedCalendarEvents.set(event.id, event);
        if (!matchedKeywords.includes(word)) {
          matchedKeywords.push(word);
        }
      });
    }
  }

  // 4. Build result with ALL matched sources
  const handbookSections = Array.from(matchedHandbookSections.values());
  const calendarEvents = Array.from(matchedCalendarEvents.values());

  if (handbookSections.length > 0 || calendarEvents.length > 0) {
    return {
      type: handbookSections.length > 0 ? 'handbook' : 'calendar',
      data: handbookSections.length > 0 ? handbookSections : calendarEvents,
      keywords: matchedKeywords
    };
  }

  return null;
};

export const getAIResponse = async (content: string) => {
  if (!GROK_API_KEY) {
    console.warn('Grok API Key missing. Falling back to escalation.');
    return null;
  }

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are the DYCI Assistant. Answer student questions based on the school handbook. If you don\'t know the answer, use your tools (web search, etc.) to double-check or say "I\'m not sure about that. Let me connect you to a staff member." Keep it professional and concise.',
          },
          { role: 'user', content },
        ],
        temperature: 0.5,
        max_completion_tokens: 1024,
        compound_custom: {
          tools: {
            enabled_tools: ["web_search", "code_interpreter", "visit_website"]
          }
        }
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('Error calling Grok AI:', error);
    return null;
  }
};

// Validate and normalize single-word keywords
export const validateSingleWordKeyword = (keyword: string): string | null => {
  const normalized = keyword
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric
  
  // Must be single word (no spaces), 3-20 chars
  if (normalized.length < 3 || normalized.length > 20) return null;
  if (keyword.includes(' ')) return null;
  
  return normalized;
};

export const generateKeywords = async (title: string, body: string): Promise<string[]> => {
  if (!GROK_API_KEY) {
    throw new Error('GROK_API_KEY is missing. Please check your .env file.');
  }

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'system',
            content: `Extract 3-6 single-word keywords for a school support bot. 

STRICT RULES:
1. Each keyword MUST be exactly ONE word (no spaces, no phrases)
2. Keywords should be 3-15 characters long
3. Use common search terms students would type
4. Examples of GOOD keywords: "scholarship", "enrollment", "tuition", "grade", "exam", "drop"
5. Examples of BAD keywords: "scholarship program", "how to enroll", "grade requirements"

Return ONLY a JSON object: {"keywords": ["word1", "word2", "word3"]}. No markdown.`,
          },
          { role: 'user', content: `Section Title: ${title}\nSection Content: ${body}` },
        ],
        temperature: 0.3,
        max_completion_tokens: 256,
        // No web tools needed for keyword extraction
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Grok API Error:', errBody);
      throw new Error(`AI API responded with status ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0]?.message?.content || '';

    // Attempt to parse JSON
    let keywords: string[] = [];
    try {
      const jsonStr = rawContent.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.keywords && Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords;
      }
    } catch (parseErr) {
      console.error('JSON Parse Error, falling back to regex:', parseErr);
      // Fallback: extract words from raw content
      keywords = rawContent
        .replace(/[^a-z0-9\s,]/gi, '')
        .split(/[\s,]+/)
        .filter((k: string) => k.length >= 3);
    }

    // Enforce single-word validation
    return keywords
      .map((k: string) => validateSingleWordKeyword(k))
      .filter((k: string | null): k is string => k !== null)
      .slice(0, 6); // Max 6 keywords
  } catch (error) {
    console.error('Error generating keywords:', error);
    throw error;
  }
};

export const handleIncomingMessage = async (conversationId: string, content: string) => {
  // 1. Check for keyword match - now returns ALL matching sources
  const match = await findMatch(content);

  if (match && match.data.length > 0) {
    // Build combined source data from ALL matched sections/events
    let combinedSourceData = '';
    let sourceLabel = '';

    if (match.type === 'handbook') {
      const sections = match.data as any[];
      sourceLabel = `Handbook Sections (${match.keywords.join(', ')})`;
      combinedSourceData = sections.map((s) => 
        `SECTION: "${s.title}"\n${s.content}`
      ).join('\n\n---\n\n');
    } else if (match.type === 'calendar') {
      const events = match.data as any[];
      sourceLabel = `Academic Calendar (${match.keywords.join(', ')})`;
      combinedSourceData = events.map((e, idx) => {
        const parts = e.date.split('-');
        let dateStr = e.date;
        if (parts.length === 3) {
          const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const m = parseInt(parts[1]) - 1;
          if (m >= 0 && m < 12) {
            dateStr = `${months[m]} ${parseInt(parts[2])}, ${parts[0]}`;
          }
        }
        return `[${idx + 1}] ${e.title} - ${dateStr} (${e.type})`;
      }).join('\n');
    }

    if (combinedSourceData) {
      // Use AI to synthesize answer from ALL matched sources (no web tools)
      const summaryReply = await getSummarizedResponse(content, combinedSourceData, sourceLabel, match.keywords);
      const botReply = summaryReply || formatDefaultReply(sourceLabel, match.data, match.type);

      await safeInsert('chat_messages', {
        conversation_id: conversationId,
        sender_id: null,
        message: botReply,
        is_auto_reply: true
      });

      return { type: 'auto_reply', content: botReply };
    }
  }

  // 2. No keyword match - Skip AI entirely and escalate directly (NO web search)
  // Re-open conversation if it was resolved, clear assignment for fresh start
  await supabase
    .from('conversations')
    .update({ 
      status: 'open',
      assigned_admin_id: null,
      last_student_message_at: new Date().toISOString()
    })
    .eq('id', conversationId);
  
  const escalationMsg = "I couldn't find information about that in our handbook or calendar. 🤝 **Connecting you to a staff member.** Please wait a moment while I transfer this inquiry...";
  await safeInsert('chat_messages', {
    conversation_id: conversationId,
    sender_id: null,
    message: escalationMsg,
    is_auto_reply: true
  });

  return { type: 'escalation', content: escalationMsg };
};

// Format default reply when AI summary fails
const formatDefaultReply = (sourceLabel: string, data: any[], type: 'handbook' | 'calendar'): string => {
  if (type === 'handbook') {
    const sections = data.slice(0, 3); // Max 3 sections in default reply
    const sectionsText = sections.map(s => `**${s.title}**\n${s.content.substring(0, 300)}${s.content.length > 300 ? '...' : ''}`).join('\n\n');
    return `📚 **${sourceLabel}**\n\nI found relevant information:\n\n${sectionsText}\n\n*If this doesn't fully answer your question, please type more details.*`;
  } else {
    const events = data.slice(0, 5); // Max 5 events
    const eventsText = events.map((e: any) => `• **${e.title}** - ${new Date(e.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`).join('\n');
    return `📅 **${sourceLabel}**\n\nI found these events:\n\n${eventsText}\n\n*Check the Calendar page for the full schedule.*`;
  }
};

// AI function that ONLY summarizes provided data (no web tools)
const getSummarizedResponse = async (
  question: string, 
  sourceData: string, 
  sourceLabel: string, 
  keywords: string[] = []
): Promise<string | null> => {
  if (!GROK_API_KEY) {
    console.warn('Grok API Key missing. Using default formatting.');
    return null;
  }

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are the DYCI Assistant. You have been given specific school data to answer a student question. 

IMPORTANT RULES:
1. Answer using ONLY the provided source data below
2. DO NOT search the web or use any external information
3. Synthesize information from multiple sources if needed
4. If the source data doesn't fully answer the question, acknowledge what you found and suggest the user ask for more details
5. Be professional, concise, and helpful
6. When citing information, mention the SECTION TITLE in parentheses, e.g., "(from Enrollment Procedures)" or "(Student Organizations section)"
7. DO NOT use citation numbers like [1], [2], etc.

Source: ${sourceLabel}
Matched Keywords: ${keywords.join(', ')}`,
          },
          { 
            role: 'user', 
            content: `Student Question: ${question}\n\nSource Data:\n${sourceData}` 
          },
        ],
        temperature: 0.3,
        max_completion_tokens: 512,
        // NO web tools - we only want to summarize the provided data
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error('Error calling Grok AI for summary:', error);
    return null;
  }
};
