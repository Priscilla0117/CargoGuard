-- Node/libSQL stores small demo documents durably here. Worker deployments use
-- R2 instead. Original organiser bytes remain embedded and are not duplicated.
CREATE TABLE attachment_blobs (
  object_key TEXT PRIMARY KEY NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL CHECK(size>=0 AND size<=5242880)
);
CREATE TRIGGER attachment_blobs_no_update BEFORE UPDATE ON attachment_blobs
BEGIN SELECT RAISE(ABORT, 'Original attachment bytes cannot be overwritten'); END;
