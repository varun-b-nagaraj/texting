'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const USERNAME_KEY = 'chat_username';
const ROOM_CODE_KEY = 'chat_room_code';
const ALLOWED_ROOM_CODES = new Set(['neniboo!', 'hasitBandaru!']);
const DEFAULT_HEADER_PHRASE = 'Private room chat';
const NENIBOO_ROOM_CODE = 'neniboo!';
const HASIT_ROOM_CODE = 'hasitBandaru!';

const EMOJIS = ['😂', '👍', '😮', '😢', '😡'];
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_BUCKET = 'chat-uploads';
const MESSAGE_PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD = 140;
const ENCRYPTION_PREFIX = 'enc:v1:';
const ENCRYPTION_SALT = 'neniboo-chat-e2ee-salt-v1';
const ENCRYPTION_ITERATIONS = 250000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const bytesToBase64 = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

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
  const [roomCode, setRoomCode] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState('');
  const [configError, setConfigError] = useState('');
  const [headerPhrase, setHeaderPhrase] = useState(DEFAULT_HEADER_PHRASE);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
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
  const isRestrictedRoom = false;

  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const swipeMetaRef = useRef({ startX: 0, startY: 0, active: false, isOwn: false });
  const swipePulseRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const lastMessageRef = useRef(null);
  const forceScrollRef = useRef(false);
  const encryptionKeyCacheRef = useRef(new Map());

  const isNearBottom = (container, threshold = 160) =>
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

  const scrollToBottom = (behavior = 'auto') => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const getEncryptionKey = async (code) => {
    if (encryptionKeyCacheRef.current.has(code)) {
      return encryptionKeyCacheRef.current.get(code);
    }
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      return null;
    }

    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      textEncoder.encode(code),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: textEncoder.encode(ENCRYPTION_SALT),
        iterations: ENCRYPTION_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    encryptionKeyCacheRef.current.set(code, key);
    return key;
  };

  const encryptMessageContent = async (value) => {
    if (!value || !roomCode) return value;
    if (typeof window === 'undefined' || !window.crypto?.subtle) return value;
    const key = await getEncryptionKey(roomCode);
    if (!key) return value;

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      textEncoder.encode(value)
    );
    return `${ENCRYPTION_PREFIX}${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
  };

  const decryptMessageContent = async (value) => {
    if (!value || typeof value !== 'string') return value;
    if (!value.startsWith(ENCRYPTION_PREFIX)) return value;
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      return '[Encrypted message]';
    }

    try {
      const payload = value.slice(ENCRYPTION_PREFIX.length);
      const [ivBase64, cipherBase64] = payload.split('.');
      if (!ivBase64 || !cipherBase64) return '[Unable to decrypt message]';
      const key = await getEncryptionKey(roomCode);
      if (!key) return '[Unable to decrypt message]';

      const iv = base64ToBytes(ivBase64);
      const ciphertext = base64ToBytes(cipherBase64);
      const plaintext = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );
      return textDecoder.decode(plaintext);
    } catch {
      return '[Unable to decrypt message]';
    }
  };

  const decryptMessageRecord = async (record) => {
    if (!record) return record;
    return {
      ...record,
      content: await decryptMessageContent(record.content)
    };
  };

  const decryptMessageList = async (list) =>
    Promise.all((list || []).map((item) => decryptMessageRecord(item)));

  useEffect(() => {
    if (!isConfigured) {
      setConfigError(
        'Missing environment variable. Check NEXT_PUBLIC_SUPABASE_ANON_KEY.'
      );
    }
  }, [isConfigured]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(USERNAME_KEY);
    if (saved) {
      setUsername(saved);
    }
    const savedRoom = window.localStorage.getItem(ROOM_CODE_KEY);
    if (savedRoom && ALLOWED_ROOM_CODES.has(savedRoom)) {
      setRoomCode(savedRoom);
    } else if (savedRoom) {
      window.localStorage.removeItem(ROOM_CODE_KEY);
    }
    if (saved && savedRoom && ALLOWED_ROOM_CODES.has(savedRoom)) {
      setIsAuthed(true);
    }
  }, []);

  const messageMap = useMemo(() => {
    return messages.reduce((acc, message) => {
      acc[message.id] = message;
      return acc;
    }, {});
  }, [messages]);

  useEffect(() => {
    if (!isAuthed || !username || !roomCode || !isConfigured) return;
    let isMounted = true;

    const loadMessages = async (showLoading = false) => {
      if (showLoading) {
        setLoadingMessages(true);
      }
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_code', roomCode)
        .order('created_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) {
        console.error(error);
      }

      if (isMounted) {
        const orderedRaw = (data || []).slice().reverse();
        const ordered = await decryptMessageList(orderedRaw);
        setMessages(ordered);
        setOnlineUsers(Array.from(new Set([username, ...ordered.map((item) => item.user_name)])));
        setTypingUsers([]);
        setHasMoreMessages((data || []).length === MESSAGE_PAGE_SIZE);
        if (showLoading) {
          setLoadingMessages(false);
        }
      }
    };

    const loadReads = async () => {
      const { data } = await supabase
        .from('user_reads')
        .select('last_read_at')
        .eq('username', username)
        .eq('room_code', roomCode)
        .maybeSingle();

      if (data?.last_read_at && isMounted) {
        setLastReadAt(data.last_read_at);
      }
    };

    loadMessages(true);
    loadReads();
    const poll = window.setInterval(() => {
      loadMessages();
      loadReads();
    }, 2500);

    return () => {
      isMounted = false;
      window.clearInterval(poll);
    };
  }, [isAuthed, username, roomCode, isConfigured]);

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
    if (!username || !roomCode || !isConfigured) return;
    const value = timestamp || new Date().toISOString();
    setLastReadAt(value);
    await supabase
      .from('user_reads')
      .upsert({ username, room_code: roomCode, last_read_at: value }, { onConflict: 'username,room_code' });
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

  const loadOlderMessages = async () => {
    if (loadingOlderRef.current || loadingMessages || loadingMoreMessages || !hasMoreMessages) {
      return;
    }
    const oldest = messages[0];
    if (!oldest?.created_at) return;

    loadingOlderRef.current = true;
    setLoadingMoreMessages(true);
    const container = listRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_code', roomCode)
        .order('created_at', { ascending: false })
        .lt('created_at', oldest.created_at)
        .limit(MESSAGE_PAGE_SIZE);

      if (error) {
        console.error(error);
      }

      const olderRaw = (data || []).slice().reverse();
      const older = await decryptMessageList(olderRaw);
      if (older.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((item) => item.id));
          const nextOlder = older.filter((item) => !existingIds.has(item.id));
          return nextOlder.length > 0 ? [...nextOlder, ...prev] : prev;
        });
      }
      setHasMoreMessages((data || []).length === MESSAGE_PAGE_SIZE);

      if (container) {
        window.requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        });
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingMoreMessages(false);
    }
  };

  const handleScroll = () => {
    const container = listRef.current;
    if (!container) return;
    stickToBottomRef.current = isNearBottom(container);
    if (container.scrollTop <= LOAD_MORE_THRESHOLD && hasMoreMessages && messages.length > 0) {
      loadOlderMessages();
    }
  };

  const handleAuth = (event) => {
    event.preventDefault();

    const candidate = username || usernameInput.trim();
    const nextRoomCode = roomCode || roomCodeInput.trim();
    if (!candidate) {
      setAuthError('Choose a username to continue.');
      return;
    }
    if (!nextRoomCode) {
      setAuthError('Enter a room code to continue.');
      return;
    }
    if (!ALLOWED_ROOM_CODES.has(nextRoomCode)) {
      setAuthError('Invalid room code.');
      return;
    }

    if (!username) {
      window.localStorage.setItem(USERNAME_KEY, candidate);
      setUsername(candidate);
    }
    if (!roomCode) {
      window.localStorage.setItem(ROOM_CODE_KEY, nextRoomCode);
      setRoomCode(nextRoomCode);
    }

    setAuthError('');
    setIsAuthed(true);
  };

  const addPendingImages = (files) => {
    if (isRestrictedRoom || !files || files.length === 0 || editingId) return;
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

  useEffect(() => {
    if (!isRestrictedRoom) return;
    setReplyTo(null);
    setEditingId(null);
    setEditingText('');
    setReactionTarget(null);
    clearPendingImages();
  }, [isRestrictedRoom]);

  const handleDragOver = (event) => {
    if (isRestrictedRoom || editingId) return;
    event.preventDefault();
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (event) => {
    if (isRestrictedRoom) return;
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDraggingFiles(false);
  };

  const handleDrop = (event) => {
    if (isRestrictedRoom || editingId) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    addPendingImages(event.dataTransfer.files);
  };

  const handleSend = async () => {
    if (sending || !isConfigured) return;
    forceScrollRef.current = true;
    stickToBottomRef.current = true;

    if (!isRestrictedRoom && editingId) {
      const trimmed = editingText.trim();
      if (!trimmed) return;
      setSending(true);
      const encrypted = await encryptMessageContent(trimmed);
      const { data } = await supabase
        .from('messages')
        .update({ content: encrypted, edited_at: new Date().toISOString() })
        .eq('id', editingId)
        .eq('room_code', roomCode)
        .select('*')
        .single();
      if (data) {
        const decoded = await decryptMessageRecord(data);
        setMessages((prev) =>
          prev.map((item) => (item.id === editingId ? decoded : item))
        );
      }
      setEditingId(null);
      setEditingText('');
      setSending(false);
      return;
    }

    const trimmed = newMessage.trim();
    if (!trimmed && (isRestrictedRoom || pendingImages.length === 0)) return;

    setSending(true);
    const messageId = crypto.randomUUID();
    const attachments = [];

    if (!isRestrictedRoom && pendingImages.length > 0) {
      for (const item of pendingImages) {
        const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${messageId}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage
          .from(UPLOAD_BUCKET)
          .upload(`${roomCode}/${path}`, item.file);
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
          path: `${roomCode}/${path}`
        });
      }
    }

    if (!trimmed && attachments.length === 0) {
      setSending(false);
      return;
    }

    const encrypted = trimmed ? await encryptMessageContent(trimmed) : null;
    const { data } = await supabase
      .from('messages')
      .insert({
        id: messageId,
        room_code: roomCode,
        content: encrypted,
        user_name: username,
        reply_to: isRestrictedRoom ? null : replyTo?.id || null,
        attachments: isRestrictedRoom ? [] : attachments
      })
      .select('*')
      .single();

    if (data) {
      const decoded = await decryptMessageRecord(data);
      setMessages((prev) =>
        [...prev, decoded].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      );
    }

    setNewMessage('');
    setReplyTo(null);
    if (!isRestrictedRoom) {
      clearPendingImages();
    }
    setSending(false);
    markRead(new Date().toISOString());
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const updateTyping = (value) => {
    return value;
  };

  const startReply = (message) => {
    if (isRestrictedRoom) return;
    setReplyTo(message);
    setEditingId(null);
    setEditingText('');
  };

  const startEdit = (message) => {
    if (isRestrictedRoom) return;
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
    if (isRestrictedRoom) return;
    const deleted = {
      deleted_at: new Date().toISOString(),
      content: null,
      reactions: {},
      attachments: []
    };
    await supabase
      .from('messages')
      .update(deleted)
      .eq('id', messageId)
      .eq('room_code', roomCode);
    setMessages((prev) =>
      prev.map((item) => (item.id === messageId ? { ...item, ...deleted } : item))
    );
  };

  const toggleReaction = async (messageId, emoji) => {
    if (isRestrictedRoom) return;
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

    await supabase
      .from('messages')
      .update({ reactions: nextReactions })
      .eq('id', messageId)
      .eq('room_code', roomCode);
  };

  const promptCustomReaction = (messageId) => {
    if (isRestrictedRoom) return;
    const emoji = window.prompt('Type or paste an emoji');
    if (!emoji) return;
    toggleReaction(messageId, emoji.trim());
  };

  const handleSwipeStart = (message, event) => {
    if (isRestrictedRoom) return;
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
    if (isRestrictedRoom) return;
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
    if (isRestrictedRoom) return;
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
    if (isRestrictedRoom || editingId) return;
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
            Enter your username and room code to continue.
          </p>
          {configError && <div className="error-text">{configError}</div>}
        </div>
      </main>
    );
  }

  if (!isAuthed || !username || !roomCode) {
    return (
      <main className="app-shell">
        <form className="auth-card" onSubmit={handleAuth}>
          <div>
            <h1 className="auth-title">Neniboo Chat</h1>
            <p className="auth-subtitle">Enter your username and room code.</p>
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
          {!roomCode && (
            <div className="auth-field">
              <label htmlFor="roomCode">Room code</label>
              <input
                id="roomCode"
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value)}
                placeholder="Enter room code"
                maxLength={60}
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
            {roomCode && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  window.localStorage.removeItem(ROOM_CODE_KEY);
                  setRoomCode('');
                }}
              >
                Join a different room
              </button>
            )}
          </div>
        </form>
      </main>
    );
  }

  const composerValue = editingId ? editingText : newMessage;
  const hasContext = !isRestrictedRoom && Boolean(replyTo || editingId);
  const presenceUsers = onlineUsers.length ? onlineUsers : [username];
  const roomSubtitle = roomCode === HASIT_ROOM_CODE ? 'Room: hasitBandaru!' : headerPhrase;
  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ROOM_CODE_KEY);
    }
    setRoomCode('');
    setRoomCodeInput('');
    setIsAuthed(false);
    setAuthError('');
  };

  return (
    <main className="app-shell">
      <div className="chat-shell">
        <header className="chat-header">
          <div className="header-title">
            <span>Neniboo Chat</span>
            <span>{roomSubtitle}</span>
          </div>
          <div className="header-meta">
            {unread && (
              <span className="unread-indicator">
                Unread <span className="unread-dot" />
              </span>
            )}
            <button type="button" className="header-btn" onClick={handleLogout}>
              Log out
            </button>
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
                {loadingMoreMessages && !loadingMessages && (
                  <div className="empty-state">Loading older messages...</div>
                )}
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
                          {!isRestrictedRoom && replyMessage && (
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

                        {!isDeleted && !isRestrictedRoom && (
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

                        {!isDeleted && !isRestrictedRoom && attachments.length > 0 && (
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

                        {!isRestrictedRoom && reactionTarget === message.id && (
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

                        {!isRestrictedRoom && Object.keys(reactions).length > 0 && (
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
            {!isRestrictedRoom && pendingImages.length > 0 && (
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
  useEffect(() => {
    let active = true;

    if (roomCode !== NENIBOO_ROOM_CODE) {
      setHeaderPhrase(DEFAULT_HEADER_PHRASE);
      return () => {
        active = false;
      };
    }

    fetch('/falling-phrases.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !Array.isArray(data)) return;
        const phrases = data.filter(
          (entry) => typeof entry === 'string' && entry.trim().length > 0
        );
        if (phrases.length === 0) {
          setHeaderPhrase(DEFAULT_HEADER_PHRASE);
          return;
        }
        setHeaderPhrase(phrases[Math.floor(Math.random() * phrases.length)]);
      })
      .catch(() => {
        setHeaderPhrase(DEFAULT_HEADER_PHRASE);
      });

    return () => {
      active = false;
    };
  }, [roomCode]);
