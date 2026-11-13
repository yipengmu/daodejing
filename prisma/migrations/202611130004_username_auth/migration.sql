ALTER TABLE "AuthIdentity" DROP CONSTRAINT "Identity_kind_values";
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "Identity_kind_values" CHECK (kind IN ('EMAIL', 'PHONE', 'USERNAME'));
