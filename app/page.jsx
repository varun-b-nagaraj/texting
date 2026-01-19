'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const DEVICE_AUTH_KEY = 'chat_authed';
const USERNAME_KEY = 'chat_username';
const DEFAULT_HEADER_PHRASE = 'If no one told u today, i think u so cute muah!!';

const EMOJIS = ['😂', '👍', '😮', '😢', '😡'];
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_BUCKET = 'chat-uploads';

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (date >= startOfToday && date < startOfTomorrow) {
    return time;
  }

  if (date >= startOfYesterday && date < startOfToday) {
    return `Yesterday ${time}`;
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  const dateLabel = date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  });

  return `${dateLabel} ${time}`;
};

const updateFavicon = (showUnread) => {
  if (typeof document === 'undefined') return;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.sizes = 'any';
  link.href = showUnread ? '/favicon2.png' : '/favicon1.png';
};

export default function Home() {
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [hasDeviceAuth, setHasDeviceAuth] = useState(false);
  const [authError, setAuthError] = useState('');
  const [configError, setConfigError] = useState('');
  const [headerPhrase, setHeaderPhrase] = useState(DEFAULT_HEADER_PHRASE);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [reactionTarget, setReactionTarget] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [lastReadAt, setLastReadAt] = useState(null);
  const [unread, setUnread] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [swipeMessageId, setSwipeMessageId] = useState(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipePulse, setSwipePulse] = useState(null);

  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const swipeMetaRef = useRef({ startX: 0, startY: 0, active: false, isOwn: false });
  const swipePulseRef = useRef(null);
  const presenceRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);
  const lastMessageRef = useRef(null);
  const forceScrollRef = useRef(false);

  const isNearBottom = (container, threshold = 160) =>
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

  const scrollToBottom = (behavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.NEXT_PUBLIC_CHAT_PASSWORD
  );

  useEffect(() => {
    if (!isConfigured) {
      setConfigError(
        'Missing environment variables. Check NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and NEXT_PUBLIC_CHAT_PASSWORD.'
      );
    }
  }, [isConfigured]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(USERNAME_KEY);
    if (saved) {
      setUsername(saved);
    }
    const deviceAuth = window.localStorage.getItem(DEVICE_AUTH_KEY) === 'true';
    if (deviceAuth) {
      setHasDeviceAuth(true);
      setIsAuthed(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/falling-phrases.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !Array.isArray(data)) return;
        const phrases = data.filter(
          (entry) => typeof entry === 'string' && entry.trim().length > 0
        );
        if (phrases.length === 0) return;
        setHeaderPhrase(phrases[Math.floor(Math.random() * phrases.length)]);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const messageMap = useMemo(() => {
    return messages.reduce((acc, message) => {
      acc[message.id] = message;
      return acc;
    }, {});
  }, [messages]);

  useEffect(() => {
    if (!isAuthed || !username || !isConfigured) return;
    let isMounted = true;

    const loadMessages = async () => {
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.error(error);
      }

      if (isMounted) {
        setMessages(data || []);
        setLoadingMessages(false);
      }
    };

    const loadReads = async () => {
      const { data } = await supabase
        .from('user_reads')
        .select('last_read_at')
        .eq('username', username)
        .maybeSingle();

      if (data?.last_read_at && isMounted) {
        setLastReadAt(data.last_read_at);
      }
    };

    loadMessages();
    loadReads();

    const channel = supabase
      .channel('messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const incoming = payload.new;
          if (!incoming) return;

          setMessages((prev) => {
            const exists = prev.find((item) => item.id === incoming.id);
            let next;
            if (exists) {
              next = prev.map((item) => (item.id === incoming.id ? incoming : item));
            } else {
              next = [...prev, incoming];
            }
            return next.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          });
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [isAuthed, username, isConfigured]);

  useEffect(() => {
    if (!isAuthed || !username || !isConfigured) return;

    const presence = supabase.channel('presence', {
      config: {
        presence: { key: username }
      }
    });
    presenceRef.current = presence;

    presence.on('presence', { event: 'sync' }, () => {
      const state = presence.presenceState();
      const names = [];
      const typing = [];
      Object.keys(state).forEach((key) => {
        state[key].forEach((entry) => {
          if (entry.username) {
            names.push(entry.username);
          }
          if (entry.typing) {
            typing.push(entry.username);
          }
        });
      });
      setOnlineUsers(Array.from(new Set(names)));
      setTypingUsers(
        Array.from(new Set(typing)).filter((name) => name && name !== username)
      );
    });

    presence.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        presence.track({ username, typing: false, online_at: new Date().toISOString() });
      }
    });

    return () => {
      presenceRef.current = null;
      supabase.removeChannel(presence);
    };
  }, [isAuthed, username, isConfigured]);

  useEffect(() => {
    if (!messages.length) {
      setUnread(false);
      return;
    }
    if (!lastReadAt) {
      setUnread(true);
      return;
    }
    const latest = messages[messages.length - 1];
    const hasUnread = new Date(latest.created_at) > new Date(lastReadAt);
    setUnread(hasUnread);
  }, [messages, lastReadAt]);

  useEffect(() => {
    if (!listRef.current || !lastMessageRef.current) return;
    const latest = messages[messages.length - 1];
    if (!latest) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            markRead(latest.created_at);
          }
        });
      },
      { root: listRef.current, threshold: 0.6 }
    );
    observer.observe(lastMessageRef.current);
    return () => observer.disconnect();
  }, [messages]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const baseTitle = 'Neniboo Chat';
    document.title = baseTitle;
    updateFavicon(unread);
  }, [unread]);

  const markRead = async (timestamp) => {
    if (!username || !isConfigured) return;
    const value = timestamp || new Date().toISOString();
    setLastReadAt(value);
    await supabase
      .from('user_reads')
      .upsert({ username, last_read_at: value }, { onConflict: 'username' });
  };

  useEffect(() => {
    if (!messages.length) return;
    const latest = messages[messages.length - 1];
    const shouldScroll = forceScrollRef.current || stickToBottomRef.current;
    if (shouldScroll) {
      scrollToBottom(latest?.user_name === username ? 'smooth' : 'auto');
      stickToBottomRef.current = true;
    }
    forceScrollRef.current = false;
  }, [messages.length, username]);

  const handleScroll = () => {
    const container = listRef.current;
    if (!container) return;
    stickToBottomRef.current = isNearBottom(container);
  };

  const handleAuth = (event) => {
    event.preventDefault();
    const sharedPassword = process.env.NEXT_PUBLIC_CHAT_PASSWORD || '';

    if (!hasDeviceAuth) {
      if (passwordInput.trim() !== sharedPassword) {
        setAuthError('Incorrect password.');
        return;
      }
    }

    const candidate = username || usernameInput.trim();
    if (!candidate) {
      setAuthError('Choose a username to continue.');
      return;
    }

    if (!username) {
      window.localStorage.setItem(USERNAME_KEY, candidate);
      setUsername(candidate);
    }

    window.localStorage.setItem(DEVICE_AUTH_KEY, 'true');
    setHasDeviceAuth(true);
    setAuthError('');
    setIsAuthed(true);
    setPasswordInput('');
  };

  const addPendingImages = (files) => {
    if (!files || files.length === 0 || editingId) return;
    const next = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file)
      }));
    if (next.length === 0) return;
    setPendingImages((prev) => [...prev, ...next]);
  };

  const removePendingImage = (imageId) => {
    setPendingImages((prev) => {
      const target = prev.find((item) => item.id === imageId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== imageId);
    });
  };

  const clearPendingImages = () => {
    setPendingImages((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  };

  const handleDragOver = (event) => {
    if (editingId) return;
    event.preventDefault();
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDraggingFiles(false);
  };

  const handleDrop = (event) => {
    if (editingId) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    addPendingImages(event.dataTransfer.files);
  };

  const handleSend = async () => {
    if (sending || !isConfigured) return;
    forceScrollRef.current = true;
    stickToBottomRef.current = true;

    if (editingId) {
      const trimmed = editingText.trim();
      if (!trimmed) return;
      setSending(true);
      const { data } = await supabase
        .from('messages')
        .update({ content: trimmed, edited_at: new Date().toISOString() })
        .eq('id', editingId)
        .select('*')
        .single();
      if (data) {
        setMessages((prev) =>
          prev.map((item) => (item.id === editingId ? data : item))
        );
      }
      setEditingId(null);
      setEditingText('');
      setSending(false);
      return;
    }

    const trimmed = newMessage.trim();
    if (!trimmed && pendingImages.length === 0) return;

    setSending(true);
    const messageId = crypto.randomUUID();
    const attachments = [];

    if (pendingImages.length > 0) {
      for (const item of pendingImages) {
        const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${messageId}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage
          .from(UPLOAD_BUCKET)
          .upload(path, item.file);
        if (error) {
          console.error(error);
          continue;
        }
        const { data: urlData } = supabase.storage
          .from(UPLOAD_BUCKET)
          .getPublicUrl(path);
        attachments.push({
          name: item.file.name,
          type: item.file.type,
          size: item.file.size,
          url: urlData.publicUrl,
          path
        });
      }
    }

    if (!trimmed && attachments.length === 0) {
      setSending(false);
      return;
    }

    const { data } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        content: trimmed || null,
        user_name: username,
        reply_to: replyTo?.id || null,
        attachments
      })
      .select('*')
      .single();

    if (data) {
      setMessages((prev) =>
        [...prev, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      );
    }

    setNewMessage('');
    setReplyTo(null);
    clearPendingImages();
    setSending(false);
    markRead(new Date().toISOString());
    if (presenceRef.current && isTyping) {
      setIsTyping(false);
      presenceRef.current.track({ username, typing: false, online_at: new Date().toISOString() });
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const updateTyping = (value) => {
    if (!presenceRef.current || !username) return;
    const hasText = value.trim().length > 0;
    if (!hasText) {
      if (isTyping) {
        setIsTyping(false);
        presenceRef.current.track({
          username,
          typing: false,
          online_at: new Date().toISOString()
        });
      }
      return;
    }
    if (!isTyping) {
      setIsTyping(true);
      presenceRef.current.track({
        username,
        typing: true,
        online_at: new Date().toISOString()
      });
    }
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false);
      presenceRef.current?.track({
        username,
        typing: false,
        online_at: new Date().toISOString()
      });
    }, 1400);
  };

  const startReply = (message) => {
    setReplyTo(message);
    setEditingId(null);
    setEditingText('');
  };

  const startEdit = (message) => {
    setEditingId(message.id);
    setEditingText(message.content || '');
    setReplyTo(null);
    clearPendingImages();
  };

  const cancelContext = () => {
    setReplyTo(null);
    setEditingId(null);
    setEditingText('');
    updateTyping('');
  };

  const handleDelete = async (messageId) => {
    const deleted = {
      deleted_at: new Date().toISOString(),
      content: null,
      reactions: {},
      attachments: []
    };
    await supabase
      .from('messages')
      .update(deleted)
      .eq('id', messageId);
    setMessages((prev) =>
      prev.map((item) => (item.id === messageId ? { ...item, ...deleted } : item))
    );
  };

  const toggleReaction = async (messageId, emoji) => {
    const message = messageMap[messageId];
    if (!message) return;

    const nextReactions = { ...(message.reactions || {}) };
    const currentUsers = Array.isArray(nextReactions[emoji])
      ? nextReactions[emoji]
      : [];
    const hasReacted = currentUsers.includes(username);
    let updatedUsers;

    if (hasReacted) {
      updatedUsers = currentUsers.filter((user) => user !== username);
    } else {
      updatedUsers = [...currentUsers, username];
    }

    if (updatedUsers.length === 0) {
      delete nextReactions[emoji];
    } else {
      nextReactions[emoji] = updatedUsers;
    }

    setMessages((prev) =>
      prev.map((item) =>
        item.id === messageId ? { ...item, reactions: nextReactions } : item
      )
    );

    await supabase.from('messages').update({ reactions: nextReactions }).eq('id', messageId);
  };

  const promptCustomReaction = (messageId) => {
    const emoji = window.prompt('Type or paste an emoji');
    if (!emoji) return;
    toggleReaction(messageId, emoji.trim());
  };

  const handleSwipeStart = (message, event) => {
    swipeMetaRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      isOwn: message.user_name === username
    };
    setSwipeMessageId(message.id);
    setSwipeOffset(0);
    setIsSwiping(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleSwipeMove = (message, event) => {
    if (swipeMessageId !== message.id) return;
    const meta = swipeMetaRef.current;
    const deltaX = event.clientX - meta.startX;
    const deltaY = event.clientY - meta.startY;

    if (!meta.active) {
      if (Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY)) {
        meta.active = true;
        setIsSwiping(true);
      } else if (Math.abs(deltaY) > 6 && Math.abs(deltaY) > Math.abs(deltaX)) {
        setIsSwiping(false);
        setSwipeMessageId(null);
        setSwipeOffset(0);
        return;
      }
    }

    if (!meta.active) return;
    event.preventDefault();
    const clamped = meta.isOwn
      ? Math.max(0, Math.min(90, deltaX))
      : Math.max(-90, Math.min(0, deltaX));
    setSwipeOffset(clamped);
  };

  const handleSwipeEnd = (message, event) => {
    if (swipeMessageId !== message.id) return;
    const meta = swipeMetaRef.current;
    const deltaX = event.clientX - meta.startX;
    if (meta.active) {
      const isOwn = meta.isOwn;
      if ((isOwn && deltaX > 60) || (!isOwn && deltaX < -60)) {
        startReply(message);
      }
    }
    setIsSwiping(false);
    setSwipeOffset(0);
    window.setTimeout(() => {
      setSwipeMessageId(null);
    }, 160);
  };

  const triggerSwipePulse = (message, direction) => {
    const pulseDirection = direction === 'right' ? 'left' : 'right';
    setSwipePulse({ id: message.id, direction: pulseDirection });
    if (swipePulseRef.current) {
      window.clearTimeout(swipePulseRef.current);
    }
    swipePulseRef.current = window.setTimeout(() => {
      setSwipePulse(null);
    }, 240);
  };

  const handleWheelSwipe = (message, event) => {
    if (editingId) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (Math.abs(event.deltaX) < 20) return;
    event.preventDefault();

    const isOwn = message.user_name === username;
    const direction = event.deltaX > 0 ? 'right' : 'left';
    if ((isOwn && direction === 'right') || (!isOwn && direction === 'left')) {
      startReply(message);
      triggerSwipePulse(message, direction);
    }
  };

  if (!isConfigured) {
    return (
      <main className="app-shell">
        <div className="auth-card">
          <h1 className="auth-title">Neniboo Chat</h1>
          <p className="auth-subtitle">
            Add your Supabase credentials and shared password to continue.
          </p>
          {configError && <div className="error-text">{configError}</div>}
        </div>
      </main>
    );
  }

  if (!isAuthed || !username) {
    return (
      <main className="app-shell">
        <form className="auth-card" onSubmit={handleAuth}>
          <div>
            <h1 className="auth-title">Neniboo Chat</h1>
            <p className="auth-subtitle">
              {hasDeviceAuth
                ? 'Choose a username to continue.'
                : 'Enter the shared password. Sweet little space for us.'}
            </p>
          </div>
          {!username && (
            <div className="auth-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="Choose a name"
                maxLength={30}
                autoComplete="off"
              />
            </div>
          )}
          {!hasDeviceAuth && (
            <div className="auth-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder="Shared password"
                autoComplete="off"
              />
            </div>
          )}
          {authError && <div className="error-text">{authError}</div>}
          <div className="auth-actions">
            <button className="primary-btn" type="submit">
              Enter chat
            </button>
            {username && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  window.localStorage.removeItem(USERNAME_KEY);
                  setUsername('');
                }}
              >
                Use a different name
              </button>
            )}
          </div>
        </form>
      </main>
    );
  }

  const composerValue = editingId ? editingText : newMessage;
  const hasContext = Boolean(replyTo || editingId);
  const presenceUsers = onlineUsers.length ? onlineUsers : [];

  return (
    <main className="app-shell">
      <div className="chat-shell">
        <header className="chat-header">
          <div className="header-title">
            <span>Neniboo Chat</span>
            <span>{headerPhrase}</span>
          </div>
          <div className="header-meta">
            {unread && (
              <span className="unread-indicator">
                Unread <span className="unread-dot" />
              </span>
            )}
          </div>
        </header>

        <section className="chat-body">
          <div className="chat-content">
            <aside className="presence-panel">
              <div className="presence-title">Online</div>
              <div className="presence-list">
                {presenceUsers.length === 0 && <span>Waiting for friend</span>}
                {presenceUsers.map((name) => (
                  <span className="presence-item" key={name}>
                    <span className="presence-dot online" />
                    {name === username ? `${name} (you)` : name}
                    {typingUsers.includes(name) && (
                      <span className="typing-dots" aria-label="Typing">
                        <span />
                        <span />
                        <span />
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </aside>
            <div className="message-pane">
              <div className="message-list" ref={listRef} onScroll={handleScroll}>
                {loadingMessages && <div className="empty-state">Loading messages...</div>}
                {!loadingMessages && messages.length === 0 && (
                  <div className="empty-state">Start the first message.</div>
                )}

                {messages.map((message, index) => {
                  const previous = messages[index - 1];
                  const isGrouped =
                previous &&
                previous.user_name === message.user_name &&
                new Date(message.created_at) - new Date(previous.created_at) <
                  GROUP_WINDOW_MS;
              const isOwn = message.user_name === username;
              const isLast = index === messages.length - 1;
              const replyMessage = message.reply_to ? messageMap[message.reply_to] : null;
              const isDeleted = Boolean(message.deleted_at);
              const reactions = message.reactions || {};
              const attachments = Array.isArray(message.attachments)
                ? message.attachments
                : [];

                  return (
                <div
                  key={message.id}
                  className={`message-item ${isOwn ? 'own' : ''} ${
                    isGrouped ? 'grouped' : ''
                  }`}
                  ref={isLast ? lastMessageRef : null}
                >
                      {!isGrouped && (
                        <div className="message-meta">
                          <span>{message.user_name}</span>
                          <span>{formatTime(message.created_at)}</span>
                          {message.edited_at && <span>(edited)</span>}
                        </div>
                      )}

                      <div className={`message-content ${isOwn ? 'own' : ''}`}>
                        <div
                          className={`message-bubble ${isDeleted ? 'deleted' : ''} ${
                            isSwiping && swipeMessageId === message.id ? 'swipe-dragging' : ''
                          } ${
                            swipePulse?.id === message.id
                              ? swipePulse.direction === 'right'
                                ? 'swipe-pulse-right'
                                : 'swipe-pulse-left'
                              : ''
                          }`}
                          style={
                            swipeMessageId === message.id
                              ? { transform: `translateX(${swipeOffset * -1}px)` }
                              : undefined
                          }
                          onPointerDown={(event) => handleSwipeStart(message, event)}
                          onPointerMove={(event) => handleSwipeMove(message, event)}
                          onPointerUp={(event) => handleSwipeEnd(message, event)}
                          onPointerCancel={(event) => handleSwipeEnd(message, event)}
                          onWheel={(event) => handleWheelSwipe(message, event)}
                        >
                          {replyMessage && (
                            <div className="reply-preview">
                              Replying to {replyMessage.user_name}:{' '}
                              {replyMessage.content ||
                                (Array.isArray(replyMessage.attachments) &&
                                replyMessage.attachments.length > 0
                                  ? 'Image'
                                  : 'Deleted message')}
                            </div>
                          )}
                          {isDeleted ? 'Message deleted' : message.content}
                        </div>

                        {!isDeleted && (
                          <div className="message-actions">
                            <button
                              className="action-btn"
                              type="button"
                              onClick={() => startReply(message)}
                            >
                              Reply
                            </button>
                            <button
                              className="action-btn"
                              type="button"
                              onClick={() =>
                                setReactionTarget((current) =>
                                  current === message.id ? null : message.id
                                )
                              }
                            >
                              React
                            </button>
                            {isOwn && (
                              <>
                                <button
                                  className="action-btn"
                                  type="button"
                                  onClick={() => startEdit(message)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="action-btn"
                                  type="button"
                                  onClick={() => handleDelete(message.id)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        )}

                        {!isDeleted && attachments.length > 0 && (
                          <div className="attachment-row">
                            {attachments.map((attachment) => (
                              <a
                                key={attachment.path || attachment.url}
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="attachment-image"
                              >
                                <img src={attachment.url} alt={attachment.name} />
                              </a>
                            ))}
                          </div>
                        )}

                        {reactionTarget === message.id && (
                          <div className="reaction-picker">
                            {EMOJIS.map((emoji) => (
                              <button
                                type="button"
                                key={emoji}
                                onClick={() => toggleReaction(message.id, emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="emoji-plus"
                              onClick={() => promptCustomReaction(message.id)}
                              aria-label="More emojis"
                            >
                              +
                            </button>
                          </div>
                        )}

                        {Object.keys(reactions).length > 0 && (
                          <div className="reaction-row">
                            {Object.entries(reactions).map(([emoji, users]) => (
                              <button
                                key={emoji}
                                className={`reaction-chip ${
                                  Array.isArray(users) && users.includes(username)
                                    ? 'selected'
                                    : ''
                                }`}
                                type="button"
                                onClick={() => toggleReaction(message.id, emoji)}
                              >
                                <span>{emoji}</span>
                                <span>{Array.isArray(users) ? users.length : 0}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </div>
          </div>

          <div
            className={`composer ${isDraggingFiles ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {hasContext && (
              <div className="composer-context">
                {replyTo && (
                  <span>
                    Replying to {replyTo.user_name}:{' '}
                    {replyTo.content ||
                      (Array.isArray(replyTo.attachments) && replyTo.attachments.length > 0
                        ? 'Image'
                        : 'Deleted message')}
                  </span>
                )}
                {editingId && <span>Editing message</span>}
                <button className="secondary-btn" type="button" onClick={cancelContext}>
                  Cancel
                </button>
              </div>
            )}
            {pendingImages.length > 0 && (
              <div className="pending-attachments">
                {pendingImages.map((item) => (
                  <div className="pending-card" key={item.id}>
                    <img src={item.previewUrl} alt={item.file.name} />
                    <button type="button" onClick={() => removePendingImage(item.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="composer-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleSend();
              }}
            >
              <textarea
                value={composerValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (editingId) {
                    setEditingText(value);
                  } else {
                    setNewMessage(value);
                  }
                  updateTyping(value);
                }}
                placeholder="Write a message..."
                onKeyDown={handleKeyDown}
              />
              <button className="primary-btn" type="submit" disabled={sending}>
                {editingId ? 'Save' : 'Send'}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
