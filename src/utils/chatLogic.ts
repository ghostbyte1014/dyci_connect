import { supabase } from '../lib/supabaseClient';

// Remove direct API key imports - calls are now routed securely through Supabase Edge Function 'ai-grok'

export const normalizeMessage = (content: string): string => {
  return content
    .toLowerCase()
    .trim()
    // Replace punctuation and symbols with spaces so words aren't glued (e.g. "dyci?" or "hello,world")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'’]/g, ' ')
    // Remove any other remaining non-alphanumeric or non-whitespace characters
    .replace(/[^\w\s]/gi, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
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
  handbookSections: any[];
  calendarEvents: any[];
  keywords: string[]; // Track which keywords matched
}

export const findMatch = async (message: string): Promise<MatchResult | null> => {
  const words = extractWords(message);
  if (words.length === 0) return null;

  // 1. Get current academic year ID from school_settings
  let ayId: string | null = null;
  const { data: settings } = await supabase
    .from('school_settings')
    .select('current_academic_year_id')
    .maybeSingle()

  if (settings?.current_academic_year_id) {
    ayId = settings.current_academic_year_id
  } else {
    const { data: currentYear } = await supabase
      .from('academic_years')
      .select('id')
      .eq('is_current', true)
      .maybeSingle()

    ayId = currentYear?.id
  }

  if (!ayId) return null;

  const matchedHandbookSections = new Map<string, any>(); // section_id -> section data
  const matchedCalendarEvents = new Map<string, any>(); // event_id -> event data
  const matchedKeywords: string[] = [];

  // 1b. Smart Calendar Override - if user asks for calendar, schedule, events, or mentions months/dates, fetch all events for the AI to filter
  const lowercaseMessage = message.toLowerCase();
  const calendarTriggers = [
    'calendar', 'schedule', 'event', 'events', 'holiday', 'holidays', 'exam', 'exams',
    'class', 'classes', 'enrollment', 'school year', 'sy', 'january', 'february', 'march',
    'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const isCalendarQuery = calendarTriggers.some(trigger => lowercaseMessage.includes(trigger));

  if (isCalendarQuery) {
    const { data: allEvents } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('academic_year_id', ayId)
      .is('deleted_at', null);
    
    if (allEvents && allEvents.length > 0) {
      allEvents.forEach((event: any) => {
        matchedCalendarEvents.set(event.id, event);
      });
      matchedKeywords.push('calendar');
    }
  }

  // 2. Search Handbook Keywords - Get ALL matching sections
  const { data: handbookData } = await supabase
    .from('handbook_keywords')
    .select(`
      keyword, 
      section_id, 
      handbook_sections!inner(
        id,
        parent_id,
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

  // 3. Search Calendar Keywords - Get ALL matching events (if not already fetched by smart query)
  const { data: calData } = await supabase
    .from('calendar_event_keywords')
    .select(`
      keyword,
      event_id,
      calendar_events!inner(*)
    `)
    .in('keyword', words)
    .eq('calendar_events.academic_year_id', ayId)
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
      .eq('academic_year_id', ayId)
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

  // 4. Build result with ALL matched sources, including parents and children for handbook sections
  let handbookSections = Array.from(matchedHandbookSections.values());
  const calendarEvents = Array.from(matchedCalendarEvents.values());

  if (handbookSections.length > 0) {
    const allFetchedSections = new Map<string, any>();
    // Pre-populate with matched sections
    handbookSections.forEach(s => allFetchedSections.set(s.id, s));

    // 4a. Fetch ALL ancestor sections recursively for context & path resolution
    let parentIdsToFetch = handbookSections
      .map(s => s.parent_id)
      .filter((id): id is string => id !== null && !allFetchedSections.has(id));

    while (parentIdsToFetch.length > 0) {
      const { data: parents } = await supabase
        .from('handbook_sections')
        .select('id, parent_id, title, content')
        .in('id', parentIdsToFetch)
        .eq('is_archived', false)
        .is('deleted_at', null);

      if (!parents || parents.length === 0) break;

      parents.forEach((parent: any) => {
        allFetchedSections.set(parent.id, parent);
      });

      // Find next level of parents
      parentIdsToFetch = parents
        .map((p: any) => p.parent_id)
        .filter((id: string | null): id is string => id !== null && !allFetchedSections.has(id));
    }

    // 4b. Fetch child sections for directly matched sections
    const sectionIds = handbookSections.map(s => s.id);
    const { data: children } = await supabase
      .from('handbook_sections')
      .select('id, parent_id, title, content')
      .in('parent_id', sectionIds)
      .eq('is_archived', false)
      .is('deleted_at', null);

    if (children && children.length > 0) {
      children.forEach((child: any) => {
        if (!allFetchedSections.has(child.id)) {
          allFetchedSections.set(child.id, child);
        }
      });
    }

    // Helper to recursively build full hierarchical path
    const buildPath = (sectionId: string): string => {
      const pathTitles: string[] = [];
      let current = allFetchedSections.get(sectionId);
      while (current) {
        pathTitles.unshift(current.title);
        current = current.parent_id ? allFetchedSections.get(current.parent_id) : null;
      }
      return pathTitles.join(' - ');
    };

    // Update all sections with their full structural title path
    const updatedSections = Array.from(allFetchedSections.values()).map(s => ({
      ...s,
      title: buildPath(s.id)
    }));

    handbookSections = updatedSections;
  }

  if (handbookSections.length > 0 || calendarEvents.length > 0) {
    return {
      handbookSections,
      calendarEvents,
      keywords: matchedKeywords
    };
  }

  return null;
};

export const getAIResponse = async (content: string) => {
  try {
    const { data, error } = await supabase.functions.invoke('ai-grok', {
      body: {
        action: 'ai-response',
        payload: { content }
      }
    });

    if (error) {
      console.warn('Grok Edge Function Error:', error);
      return null;
    }

    return data?.content || null;
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
  try {
    const { data, error } = await supabase.functions.invoke('ai-grok', {
      body: {
        action: 'generate-keywords',
        payload: { title, body }
      }
    });

    if (error) {
      console.error('Grok Edge Function Error during keyword generation:', error);
      throw error;
    }

    const rawContent = data?.content || '';

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

const checkPleasantries = (content: string): string | null => {
  const normalized = normalizeMessage(content);
  
  const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'greetings', 'yo'];
  const thanks = ['thank you', 'thanks', 'thank', 'salamat', 'ty', 'thankyou', 'thank you so much'];
  const closures = ['bye', 'goodbye', 'bye bye', 'exit', 'quit'];
  const acknowledgments = ['ok', 'okay', 'sure', 'noted'];

  if (thanks.includes(normalized) || thanks.some(t => normalized === t || normalized.startsWith(t + ' '))) {
    return "You're very welcome! 😊 Let me know if you have any other questions about DYCI.";
  }
  
  if (greetings.includes(normalized) || greetings.some(g => normalized === g || normalized.startsWith(g + ' '))) {
    return "Hello! 👋 How can I help you today? You can ask me about school policies, handbook guidelines, or calendar events.";
  }

  if (closures.includes(normalized)) {
    return "Goodbye! Have a great day ahead! 👋";
  }

  if (acknowledgments.includes(normalized)) {
    return "Got it! Let me know if there's anything else I can assist you with. 👍";
  }

  return null;
};

export const handleIncomingMessage = async (conversationId: string, content: string) => {
  const normalized = content.toLowerCase().trim();
  const adminTriggers = ['chat with admin', 'human', 'talk to human', 'agent', 'support staff', 'connect to admin'];

  // 1. Direct Escalation Check (bypassing pleasantries and keyword scanner)
  if (adminTriggers.includes(normalized)) {
    await supabase
      .from('conversations')
      .update({ 
        status: 'open',
        assigned_admin_id: null,
        last_student_message_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    const transferMsg = "🤝 **Connecting you to a staff member.** Please wait a moment while I transfer this inquiry...";
    await safeInsert('chat_messages', {
      conversation_id: conversationId,
      sender_id: null,
      message: transferMsg,
      is_auto_reply: true
    });

    return { type: 'escalation', content: transferMsg };
  }

  // 2. Active Admin Check with 5-Minute Inactivity Safety Net
  const { data: conv } = await supabase
    .from('conversations')
    .select('status, assigned_admin_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (conv && conv.status === 'open' && conv.assigned_admin_id) {
    const { data: lastMessages } = await supabase
      .from('chat_messages')
      .select('sender_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lastMessages && lastMessages.length > 0) {
      const lastMsg = lastMessages[0];
      
      // If the last message was sent by the student, calculate elapsed idle time
      if (lastMsg.sender_id !== null) {
        const lastMsgTime = new Date(lastMsg.created_at).getTime();
        const elapsedMinutes = (Date.now() - lastMsgTime) / 60000;
        
        // If student has been waiting for less than 5 minutes, bypass the bot
        if (elapsedMinutes < 5) {
          return { type: 'bypass_active_admin' };
        }
        console.log('[ChatBot] Admin inactive for 5+ minutes. Reactivating chatbot.');
      } else {
        // Last message was from admin/system; admin is active, bypass bot
        return { type: 'bypass_active_admin' };
      }
    }
  }

  // Check for conversational pleasantries first to avoid unnecessary admin escalation
  const pleasantryReply = checkPleasantries(content);
  if (pleasantryReply) {
    await safeInsert('chat_messages', {
      conversation_id: conversationId,
      sender_id: null,
      message: pleasantryReply,
      is_auto_reply: true
    });
    return { type: 'pleasantry_reply', content: pleasantryReply };
  }

  // 1. Check for keyword match - now returns ALL matching sources
  const match = await findMatch(content);

  if (match && (match.handbookSections.length > 0 || match.calendarEvents.length > 0)) {
    // Build combined source data from ALL matched sections/events
    let combinedSourceData = '';
    const sourceLabels: string[] = [];

    if (match.handbookSections.length > 0) {
      sourceLabels.push(`Handbook Sections (${match.keywords.filter(k => k !== 'calendar').join(', ')})`);
      combinedSourceData += `--- HANDBOOK SECTIONS ---\n` + match.handbookSections.map((s) => 
        `SECTION: "${s.title}"\n${s.content}`
      ).join('\n\n---\n\n') + '\n\n';
    }

    if (match.calendarEvents.length > 0) {
      sourceLabels.push(`Academic Calendar`);
      combinedSourceData += `--- CALENDAR EVENTS ---\n` + match.calendarEvents.map((e, idx) => {
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
      }).join('\n') + '\n\n';
    }

    const sourceLabel = sourceLabels.join(' & ');

    if (combinedSourceData) {
      // Use AI to synthesize answer from ALL matched sources (no web tools)
      const summaryReply = await getSummarizedResponse(content, combinedSourceData, sourceLabel, match.keywords);
      let botReply = summaryReply || formatDefaultReply(sourceLabel, match.handbookSections, match.calendarEvents);

      // Append references/source location info if matched handbook
      if (match.handbookSections.length > 0 && summaryReply) {
        const uniqueTitles = Array.from(new Set(match.handbookSections.map((s: any) => s.title)));
        if (uniqueTitles.length > 0) {
          botReply += `\n\n📖 **References from Handbook:**\n` + uniqueTitles.map(t => `• **${t}**`).join('\n');
        }
      }

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
const formatDefaultReply = (sourceLabel: string, handbookSections: any[], calendarEvents: any[]): string => {
  let reply = `📚 **${sourceLabel}**\n\nI found relevant information:\n\n`;
  if (handbookSections.length > 0) {
    const sectionsText = handbookSections.slice(0, 2).map(s => `**${s.title}**\n${s.content.substring(0, 250)}${s.content.length > 250 ? '...' : ''}`).join('\n\n');
    reply += `**Handbook:**\n${sectionsText}\n\n`;
  }
  if (calendarEvents.length > 0) {
    const eventsText = calendarEvents.slice(0, 5).map((e: any) => `• **${e.title}** - ${new Date(e.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} (${e.type})`).join('\n');
    reply += `**Calendar Events:**\n${eventsText}\n\n`;
  }
  reply += `*If this doesn't fully answer your question, please type more details.*`;
  return reply;
};

// AI function that ONLY summarizes provided data (no web tools)
const getSummarizedResponse = async (
  question: string, 
  sourceData: string, 
  sourceLabel: string, 
  keywords: string[] = []
): Promise<string | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('ai-grok', {
      body: {
        action: 'summarized-response',
        payload: { question, sourceData, sourceLabel, keywords }
      }
    });

    if (error) {
      console.warn('Grok Edge Function Error during summary:', error);
      return null;
    }

    return data?.content || null;
  } catch (error) {
    console.error('Error calling Grok AI for summary:', error);
    return null;
  }
};
