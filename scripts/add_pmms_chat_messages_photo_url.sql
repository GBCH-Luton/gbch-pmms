-- Team Chat photo attachments. body stays NOT NULL, but an empty string
-- already satisfies that constraint -- a photo-only message (no caption)
-- sends with body: '', no relaxation needed.

alter table pmms.chat_messages add column if not exists photo_url text;

notify pgrst, 'reload schema';
