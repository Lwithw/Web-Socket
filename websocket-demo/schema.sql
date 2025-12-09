-- Enhanced Chat System Schema with all features

-- Users table with encryption keys and preferences
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  identity_key TEXT NOT NULL, -- Signal Protocol identity key
  signed_prekey TEXT NOT NULL,
  prekey_signature TEXT NOT NULL,
  one_time_prekeys TEXT[], -- Array of one-time prekeys
  registration_id INTEGER NOT NULL,
  profile_picture TEXT,
  status VARCHAR(50) DEFAULT 'online',
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enhanced messages table
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  content TEXT NOT NULL, -- Encrypted content
  room_name VARCHAR(255) DEFAULT 'general',
  message_type VARCHAR(50) NOT NULL DEFAULT 'text', -- text, image, video, document, voice, sticker, gif
  recipient_id VARCHAR(255), -- For DMs
  group_id VARCHAR(255), -- For group messages
  media_url TEXT, -- URL to media file
  media_type VARCHAR(50), -- image/jpeg, video/mp4, etc.
  media_size INTEGER, -- File size in bytes
  media_thumbnail TEXT, -- Thumbnail for images/videos
  media_duration INTEGER, -- Duration for voice/video in seconds
  encrypted BOOLEAN DEFAULT false,
  encryption_metadata JSONB, -- Signal Protocol session info
  delivered BOOLEAN DEFAULT false,
  seen BOOLEAN DEFAULT false,
  seen_at TIMESTAMP,
  starred BOOLEAN DEFAULT false,
  pinned BOOLEAN DEFAULT false,
  reply_to INTEGER REFERENCES messages(id),
  edited BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP
);

-- Read receipts tracking
CREATE TABLE IF NOT EXISTS read_receipts (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id)
);

-- Blocked users
CREATE TABLE IF NOT EXISTS blocked_users (
  id SERIAL PRIMARY KEY,
  blocker_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(blocker_id, blocked_id)
);

-- Reported users
CREATE TABLE IF NOT EXISTS user_reports (
  id SERIAL PRIMARY KEY,
  reporter_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  message_id INTEGER REFERENCES messages(id),
  status VARCHAR(50) DEFAULT 'pending', -- pending, reviewed, resolved
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

-- Groups/Rooms
CREATE TABLE IF NOT EXISTS groups (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  creator_id VARCHAR(255) NOT NULL REFERENCES users(id),
  group_type VARCHAR(50) DEFAULT 'public', -- public, private
  avatar TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group members
CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id VARCHAR(255) NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- admin, moderator, member
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);


-- Signal Protocol sessions (for E2E encryption)
CREATE TABLE IF NOT EXISTS signal_sessions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_data TEXT NOT NULL, -- Serialized session state
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, peer_id)
);

-- Signal Protocol keys storage
CREATE TABLE IF NOT EXISTS signal_keys (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  identity_key_pair JSONB NOT NULL, -- {publicKey, privateKey}
  registration_id INTEGER NOT NULL,
  pre_key_bundle JSONB NOT NULL, -- Complete pre-key bundle
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages(sender_id, starred) WHERE starred = true;
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(room_name, pinned) WHERE pinned = true;
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_messages_delivered ON messages(recipient_id, delivered) WHERE delivered = false;
CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(recipient_id, seen) WHERE seen = false;
CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- Update updated_at automatically
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $f$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  END IF;
END$$;

DO $$
DECLARE
  trig RECORD;
BEGIN
  FOR trig IN SELECT tgname FROM pg_trigger WHERE tgname = 'trg_users_updated_at' LOOP END LOOP;
  IF NOT FOUND THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  FOR trig IN SELECT tgname FROM pg_trigger WHERE tgname = 'trg_messages_updated_at' LOOP END LOOP;
  IF NOT FOUND THEN
    CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  FOR trig IN SELECT tgname FROM pg_trigger WHERE tgname = 'trg_groups_updated_at' LOOP END LOOP;
  IF NOT FOUND THEN
    CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  FOR trig IN SELECT tgname FROM pg_trigger WHERE tgname = 'trg_signal_sessions_updated_at' LOOP END LOOP;
  IF NOT FOUND THEN
    CREATE TRIGGER trg_signal_sessions_updated_at BEFORE UPDATE ON signal_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  FOR trig IN SELECT tgname FROM pg_trigger WHERE tgname = 'trg_signal_keys_updated_at' LOOP END LOOP;
  IF NOT FOUND THEN
    CREATE TRIGGER trg_signal_keys_updated_at BEFORE UPDATE ON signal_keys
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;
