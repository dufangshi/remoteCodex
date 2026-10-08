-- Device-local conversational documents only: no tool payloads or pricing.
CREATE TABLE search_documents (
  id INTEGER PRIMARY KEY,
  document_key TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  turn_id TEXT,
  item_id TEXT,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  folded TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX search_documents_thread_idx ON search_documents(thread_id, turn_id);
CREATE VIRTUAL TABLE search_documents_fts USING fts5(
  folded, content='search_documents', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_documents_fts(rowid, folded) VALUES(NEW.id, NEW.folded);
END;
CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, folded)
  VALUES('delete', OLD.id, OLD.folded);
END;
CREATE TRIGGER search_documents_update AFTER UPDATE ON search_documents BEGIN
  INSERT INTO search_documents_fts(search_documents_fts, rowid, folded)
  VALUES('delete', OLD.id, OLD.folded);
  INSERT INTO search_documents_fts(rowid, folded) VALUES(NEW.id, NEW.folded);
END;

CREATE TRIGGER search_history_insert AFTER INSERT ON thread_history_items BEGIN
INSERT INTO search_documents(document_key, thread_id, turn_id, item_id, kind, phase, text, folded, created_at)
 SELECT 'item:' || h.id, h.thread_id, h.turn_id, h.item_id,
        json_extract(h.item_json, '$.kind'),
        COALESCE(json_extract(h.item_json, '$.phase'), json_extract(h.item_json, '$.status'), ''),
        search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source),
        search_fold(search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source)),
        h.created_at
 FROM thread_history_items h JOIN threads t ON t.id=h.thread_id
 WHERE json_extract(h.item_json, '$.kind') IN ('userMessage', 'agentMessage')
   AND search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source) IS NOT NULL
   AND h.id=NEW.id;
END;
CREATE TRIGGER search_history_update AFTER UPDATE ON thread_history_items BEGIN
 DELETE FROM search_documents WHERE document_key='item:' || OLD.id;
INSERT INTO search_documents(document_key, thread_id, turn_id, item_id, kind, phase, text, folded, created_at)
 SELECT 'item:' || h.id, h.thread_id, h.turn_id, h.item_id,
        json_extract(h.item_json, '$.kind'),
        COALESCE(json_extract(h.item_json, '$.phase'), json_extract(h.item_json, '$.status'), ''),
        search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source),
        search_fold(search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source)),
        h.created_at
 FROM thread_history_items h JOIN threads t ON t.id=h.thread_id
 WHERE json_extract(h.item_json, '$.kind') IN ('userMessage', 'agentMessage')
   AND search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source) IS NOT NULL
   AND h.id=NEW.id;
END;
CREATE TRIGGER search_history_delete AFTER DELETE ON thread_history_items BEGIN
 DELETE FROM search_documents WHERE document_key='item:' || OLD.id;
END;
CREATE TRIGGER search_turn_delete AFTER DELETE ON thread_turns BEGIN
 DELETE FROM search_documents WHERE thread_id=OLD.thread_id AND turn_id=OLD.id;
END;
CREATE TRIGGER search_thread_delete AFTER DELETE ON threads BEGIN
 DELETE FROM search_documents WHERE thread_id=OLD.id;
END;
CREATE TRIGGER search_thread_insert AFTER INSERT ON threads BEGIN
 INSERT INTO search_documents(document_key, thread_id, kind, text, folded, created_at)
 VALUES('title:' || NEW.id, NEW.id, 'title', NEW.title, search_fold(NEW.title), NEW.created_at);
END;
CREATE TRIGGER search_thread_title AFTER UPDATE OF title ON threads BEGIN
 UPDATE search_documents SET text=NEW.title, folded=search_fold(NEW.title)
 WHERE document_key='title:' || NEW.id;
END;
CREATE TRIGGER search_thread_source AFTER UPDATE OF source ON threads
WHEN NEW.source != OLD.source BEGIN
 DELETE FROM search_documents WHERE thread_id=NEW.id AND kind != 'title';
INSERT INTO search_documents(document_key, thread_id, turn_id, item_id, kind, phase, text, folded, created_at)
 SELECT 'item:' || h.id, h.thread_id, h.turn_id, h.item_id,
        json_extract(h.item_json, '$.kind'),
        COALESCE(json_extract(h.item_json, '$.phase'), json_extract(h.item_json, '$.status'), ''),
        search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source),
        search_fold(search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source)),
        h.created_at
 FROM thread_history_items h JOIN threads t ON t.id=h.thread_id
 WHERE json_extract(h.item_json, '$.kind') IN ('userMessage', 'agentMessage')
   AND search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source) IS NOT NULL
   AND h.thread_id=NEW.id;
END;
-- One transactional migration backfills durable history; subsequent writes use
-- the same projection via triggers, including streaming updates and fork copies.
INSERT INTO search_documents(document_key, thread_id, kind, text, folded, created_at)
 SELECT 'title:' || id, id, 'title', title, search_fold(title), created_at FROM threads;
INSERT INTO search_documents(document_key, thread_id, turn_id, item_id, kind, phase, text, folded, created_at)
 SELECT 'item:' || h.id, h.thread_id, h.turn_id, h.item_id,
        json_extract(h.item_json, '$.kind'),
        COALESCE(json_extract(h.item_json, '$.phase'), json_extract(h.item_json, '$.status'), ''),
        search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source),
        search_fold(search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source)),
        h.created_at
 FROM thread_history_items h JOIN threads t ON t.id=h.thread_id
 WHERE json_extract(h.item_json, '$.kind') IN ('userMessage', 'agentMessage')
   AND search_body(json_extract(h.item_json, '$.text'), json_extract(h.item_json, '$.kind'), t.source) IS NOT NULL
   ;
