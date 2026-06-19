import React, { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { FaMessage, FaExpand, FaCompress } from 'react-icons/fa6'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import { handleIncomingMessage } from '../../utils/chatLogic'
import { notifyUser, notifyRole } from '../../lib/api/notifications'

interface ChatMessage {
  id: string
  from: 'student' | 'system'
  text: string
  createdAt: string
}



const StudentChatWidget: React.FC = () => {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [assignedAdminId, setAssignedAdminId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  useEffect(() => {
    if (open) {
      scrollToBottom('auto')
    }
  }, [open])

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom()
    }
  }, [messages])

  // Load conversation and history
  useEffect(() => {
    if (!user || !open) return

    let channel: any = null

    const initChat = async () => {
      setInitializing(true)
      try {
        // 1. Get all conversations where this student is a participant
        const { data: participationData } = await supabase
          .from('conversation_participants')
          .select('conversation_id, conversations(status, assigned_admin_id)')
          .eq('user_id', user.id)
          .order('joined_at', { ascending: false })

        const conversations = participationData?.map(p => ({
          id: p.conversation_id,
          status: (p.conversations as any)?.status,
          assigned_admin_id: (p.conversations as any)?.assigned_admin_id
        })) || []
        
        const activeConv = conversations.find(c => c.status !== 'resolved')
        let currentId = activeConv?.id

        // 2. If no active one, don't create yet to avoid empty convos in DB
        // We'll create it on the first message if needed.
        if (currentId) {
          setConversationId(currentId)
          setAssignedAdminId(activeConv?.assigned_admin_id || null)
        }

        // 3. Fetch all messages from all conversations to show history
        if (conversations.length > 0) {
          const { data: dbMessages } = await supabase
            .from('chat_messages')
            .select('*')
            .in('conversation_id', conversations.map(c => c.id))
            .order('created_at', { ascending: true })

          if (dbMessages) {
            setMessages(dbMessages.map((m: any) => ({
              id: m.id,
              from: (m.sender_id === user?.id ? 'student' : 'system') as 'student' | 'system',
              text: m.message,
              createdAt: m.created_at
            })))
          }
        }

        // 4. Subscribe to messages for ALL student's conversations
        channel = supabase
          .channel(`student_chat_all:${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'chat_messages'
            },
            async (payload) => {
              console.log('[Chat] Realtime INSERT received:', payload)
              const newMessage = payload.new as any
              
              // Only process if we have an active conversation
              if (!newMessage.conversation_id) return
              
              // Verify if this message belongs to a conversation this user is in
              const { data: participation } = await supabase
                .from('conversation_participants')
                .select('id')
                .eq('conversation_id', newMessage.conversation_id)
                .eq('user_id', user.id)
                .maybeSingle()
                
              if (participation) {
                console.log('[Chat] Adding message to UI:', newMessage.id)
                setMessages((prev) => {
                  if (prev.find(m => m.id === newMessage.id)) return prev
                  return [
                    ...prev,
                    {
                      id: newMessage.id,
                      from: (newMessage.sender_id === user.id ? 'student' : 'system') as 'student' | 'system',
                      text: newMessage.message,
                      createdAt: newMessage.created_at
                    }
                  ]
                })
              }
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'chat_messages'
            },
            async (payload) => {
              console.log('[Chat] Realtime UPDATE received:', payload)
              const updatedMessage = payload.new as any
              
              // Update existing message in UI (e.g., state changes from sent to delivered)
              setMessages((prev) => {
                const idx = prev.findIndex(m => m.id === updatedMessage.id)
                if (idx === -1) return prev
                const updated = [...prev]
                updated[idx] = {
                  id: updatedMessage.id,
                  from: (updatedMessage.sender_id === user.id ? 'student' : 'system') as 'student' | 'system',
                  text: updatedMessage.message,
                  createdAt: updatedMessage.created_at
                }
                return updated
              })
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'conversations'
            },
            async (payload: any) => {
              console.log('[Chat] Realtime Conversation UPDATE received:', payload)
              const updatedConv = payload.new as any
              if (currentId && updatedConv.id === currentId) {
                setAssignedAdminId(updatedConv.assigned_admin_id || null)
              }
            }
          )
          .subscribe((status) => {
            console.log('[Chat] Realtime subscription status:', status)
          })

      } catch (err) {
        console.error('Chat init error:', err)
      } finally {
        setInitializing(false)
      }
    }

    initChat()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [user?.id, open])

  const handleToggle = () => {
    setOpen((prev) => !prev)
  }

  const handleConnectAdmin = async () => {
    if (!user) return
    setSending(true)
    try {
      let activeId = conversationId

      // 1. Create conversation if none active
      if (!activeId) {
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({ status: 'open' })
          .select()
          .single()
        
        if (convError) throw convError

        if (newConv) {
          activeId = newConv.id
          
          const { error: partError } = await supabase
            .from('conversation_participants')
            .insert({
              conversation_id: activeId,
              user_id: user.id,
              p_role: 'student'
            })
          
          if (partError) throw partError
          setConversationId(activeId)
        }
      }

      if (!activeId) throw new Error('Could not initialize conversation')

      // 2. Insert student message requesting transfer
      const { error: insertError } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: activeId,
          sender_id: user.id,
          message: 'chat with admin'
        })

      if (insertError) throw insertError

      // 3. Notify Admins and run handleIncomingMessage sequence
      await notifyRole('academic_admin', 'New Support Message', `Student: ${user.user_metadata?.full_name || 'Anonymous Student'} requested to speak to an admin.`, '/admin/support')
      await handleIncomingMessage(activeId, 'chat with admin')
      
      // Update local state by loading recent history
      const { data: dbMessages } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true })

      if (dbMessages) {
        setMessages(dbMessages.map((m: any) => ({
          id: m.id,
          from: (m.sender_id === user.id ? 'student' : 'system') as 'student' | 'system',
          text: m.message,
          createdAt: m.created_at
        })))
      }
      setAssignedAdminId(null)
      toast.success('Escalated to human staff queue!')
    } catch (err) {
      console.error('Error connecting to admin:', err)
      toast.error('Could not connect to administrator.')
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || !user) return

    setSending(true)
    setInput('')

    try {
      let activeId = conversationId

      // 1. Create conversation if none active
      if (!activeId) {
        // Atomic creation
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({ status: 'open' }) // Status matches conv_status enum
          .select()
          .single()
        
        if (convError) throw convError

        if (newConv) {
          activeId = newConv.id
          
          // Add student as participant
          const { error: partError } = await supabase
            .from('conversation_participants')
            .insert({
              conversation_id: activeId,
              user_id: user.id,
              p_role: 'student'
            })
          
          if (partError) throw partError
          
          setConversationId(activeId)
        }
      }

      if (!activeId) throw new Error('Could not initialize conversation')

      // 2. Insert student message
      const { data: studentMsg, error: insertError } = await supabase
        .from('chat_messages')
        .insert({
          conversation_id: activeId,
          sender_id: user.id,
          message: trimmed // Table uses 'message' not 'content'
        })
        .select()
        .single()

      if (insertError) throw insertError

      if (studentMsg) {
        // Local echo: add message to UI immediately so it works even without Realtime enabled yet
        setMessages((prev) => {
          if (prev.find(m => m.id === studentMsg.id)) return prev
          return [
            ...prev,
            {
              id: studentMsg.id,
              from: 'student',
              text: studentMsg.message,
              createdAt: studentMsg.created_at
            }
          ]
        })

        // 3. Notify Admins
        const { data: conv } = await supabase
          .from('conversations')
          .select('assigned_admin_id')
          .eq('id', activeId)
          .single()
        
        const adminMsg = `Student: ${user.user_metadata?.full_name || 'Anonymous Student'} has sent a message.`
        
        if (conv?.assigned_admin_id) {
          await notifyUser(conv.assigned_admin_id, 'New Support Message', adminMsg, 'info', '/admin/support')
        } else {
          await notifyRole('academic_admin', 'New Support Message', adminMsg, '/admin/support')
        }

        // 4. Trigger hybrid matching logic (Bot Reply)
        await handleIncomingMessage(activeId, trimmed)
      }
    } catch (err: any) {
      console.error('Error sending message:', err)
      if (err.code === '42501') {
        console.error('RLS Violation: Please ensure "conversations" and "conversation_participants" table policies are set to allow INSERT for authenticated users.')
      }
      toast.error('Could not send message. Please try again later.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {open && (
        <div className={`fixed bottom-20 right-4 z-40 rounded-2xl bg-white shadow-xl border border-slate-200 flex flex-col overflow-hidden text-[11px] font-inter transition-all duration-300 ${
          isExpanded
            ? 'w-[500px] h-[600px] max-w-[95vw] max-h-[80vh]'
            : 'w-80 h-96 max-w-[90vw]'
        }`}>
          <div className="px-3 py-2 bg-blue-700 text-white flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold">Support chat</p>
              <p className="text-[10px] text-blue-100 flex items-center">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse"></span>
                DYCI Assistant & Staff
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-[10px] transition-colors"
                title={isExpanded ? 'Minimize Chat' : 'Maximize Chat'}
              >
                {isExpanded ? <FaCompress className="h-3 w-3" /> : <FaExpand className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={handleToggle}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition-colors"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-3 py-3 flex-1 overflow-y-auto space-y-3 bg-slate-50/50">
            {initializing ? (
              <div className="flex flex-col items-center justify-center h-full space-y-2 text-slate-400">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin"></div>
                <p className="text-[10px]">Loading history...</p>
              </div>
            ) : (
              <>                 {messages.length === 0 && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl px-3 py-2 max-w-[85%] bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm">
                      <p>👋 Hello! I'm the DYCI Assistant. Ask me anything about school policies, enrollment, or requirements. If I can't find it in the handbook, I'll connect you to an agent!</p>
                      <button
                        type="button"
                        onClick={handleConnectAdmin}
                        className="mt-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold px-2 py-1 rounded-md text-[10px] transition-all focus:outline-none"
                      >
                        🤝 Chat with Agent
                      </button>
                    </div>
                  </div>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.from === 'student' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`rounded-2xl px-3 py-2 max-w-[85%] shadow-sm ${
                        m.from === 'student'
                          ? 'bg-blue-600 text-white rounded-br-sm'
                          : 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm'
                      }`}
                    >
                      {m.from === 'system' ? (
                        // Render bot messages with markdown formatting
                        <div 
                          className="whitespace-pre-wrap break-words"
                          dangerouslySetInnerHTML={{
                            __html: m.text
                              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
                              .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
                          }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      )}
                      <p className={`text-[8px] mt-1 ${m.from === 'student' ? 'text-blue-100 text-right' : 'text-slate-400'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2 rounded-bl-sm shadow-sm flex items-center space-x-1">
                      <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {!assignedAdminId && messages.length > 0 && (
            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={handleConnectAdmin}
                className="text-[10px] text-blue-700 hover:text-blue-800 font-semibold flex items-center gap-1 focus:outline-none"
                disabled={sending}
              >
                🤝 Speak to an Agent
              </button>
            </div>
          )}

          {assignedAdminId && (
            <div className="px-3 py-1.5 bg-emerald-50 border-t border-slate-100 flex items-center justify-between text-[9px] font-semibold text-emerald-800 tracking-wide uppercase">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Connected to Agent
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="border-t border-slate-100 px-3 py-2 bg-white">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question..."
                className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
              <button
                type="submit"
                disabled={sending || !input.trim() || initializing}
                className="inline-flex items-center justify-center rounded-2xl bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-semibold px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={handleToggle}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center justify-center h-12 w-12 rounded-full bg-blue-700 text-white shadow-xl border border-blue-800 hover:bg-blue-800 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-label="Open support chat"
      >
        <FaMessage className="h-5 w-5" />
        {/* Unread dot simulation could go here */}
      </button>
    </>
  )
}

export default StudentChatWidget

