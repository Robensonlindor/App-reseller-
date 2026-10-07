-- =============================================================================
-- PLAYUP IDEMPOTENT PAYMENT, PROOF, VALIDATED PAYMENT, LEDGER & AUDIT SCHEMA
-- PostgreSQL Relational Schema with Explicit Foreign Keys, Integrity Checks,
-- Conditional Uniqueness Rules, Indexes & Financial History Immutability
-- =============================================================================
-- Core Architectural Principle:
--   STRICT SEPARATION between received payment proofs ("payment_proofs") and
--   truly validated payments ("validated_payments").
--   A submitted proof is NEVER considered a validated payment and can NEVER
--   credit a user wallet directly.
--
-- Explicit SQL Foreign Key Relations:
--   1. users.id               -> payment_requests.user_id           (ON DELETE RESTRICT)
--   2. users.id               -> payment_proofs.user_id             (ON DELETE RESTRICT)
--   3. payment_requests.id    -> payment_proofs.payment_request_id  (ON DELETE RESTRICT)
--   4. payment_requests.id    -> validated_payments.payment_request_id (ON DELETE RESTRICT)
--   5. payment_proofs.id      -> validated_payments.payment_proof_id   (ON DELETE RESTRICT)
--   6. users.id               -> validated_payments.user_id         (ON DELETE RESTRICT)
--   7. payment_requests.id    -> wallet_transactions.payment_request_id (ON DELETE RESTRICT)
--   8. validated_payments.id  -> wallet_transactions.validated_payment_id (ON DELETE RESTRICT)
--   9. users.id               -> wallet_transactions.user_id        (ON DELETE RESTRICT)
--  10. payment_requests.id    -> idempotency_keys.resource_id       (ON DELETE RESTRICT, NULLABLE)
--  11. users.id               -> idempotency_keys.user_id           (ON DELETE RESTRICT)
--  12. users.id               -> audit_logs.user_id                 (ON DELETE RESTRICT, NULLABLE)
--  13. payment_requests.id    -> audit_logs.payment_request_id      (ON DELETE RESTRICT, NULLABLE)
--  14. users.id               -> payment_audit_logs.user_id         (ON DELETE RESTRICT, NULLABLE)
--  15. users.id               -> payment_antifraud_incidents.user_id (ON DELETE RESTRICT)
--  16. users.id               -> wallet_2fa_challenges.user_id      (ON DELETE RESTRICT)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Table "users" (Root Identity & Wallet Owner Table)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'USER')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  wallet_balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
  preferred_currency TEXT NOT NULL DEFAULT 'HTG' CHECK (preferred_currency IN ('HTG', 'USD')),
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conditional uniqueness: only 1 ADMIN account can ever exist in the platform
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_single_admin
  ON users (role)
  WHERE role = 'ADMIN';

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);

-- -----------------------------------------------------------------------------
-- 2. Table "payment_requests" (Initial Payment Request — Server Source of Truth)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID NULL,
  payment_method TEXT NOT NULL,
  expected_amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Domain & Integrity Constraints:
  CONSTRAINT chk_payment_requests_expected_amount_positive
    CHECK (expected_amount > 0),
  CONSTRAINT chk_payment_requests_payment_method
    CHECK (payment_method IN ('moncash', 'natcash')),
  CONSTRAINT chk_payment_requests_currency
    CHECK (currency IN ('HTG', 'USD')),
  CONSTRAINT chk_payment_requests_status
    CHECK (status IN (
      'pending',
      'verifying',
      'verified',
      'credited',
      'rejected',
      'manual_review',
      'refunded',
      'expired'
    )),
  CONSTRAINT chk_payment_requests_idempotency_non_empty
    CHECK (length(trim(idempotency_key)) > 0),
  CONSTRAINT chk_payment_requests_hash_non_empty
    CHECK (length(trim(request_hash)) > 0),

  -- Mandatory Uniqueness Constraints:
  CONSTRAINT uq_payment_requests_user_idempotency
    UNIQUE (user_id, idempotency_key),
  CONSTRAINT uq_payment_requests_idempotency_key
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id
  ON payment_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status
  ON payment_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user_request_hash
  ON payment_requests (user_id, request_hash);

CREATE INDEX IF NOT EXISTS idx_payment_requests_order_id
  ON payment_requests (order_id)
  WHERE order_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Table "payment_proofs" (Received Payment Proofs ONLY — NEVER a Validated Payment)
-- -----------------------------------------------------------------------------
-- IMPORTANT:
--   This table stores ONLY uploaded screenshots and their OCR/forensic analysis.
--   Uploading a proof into "payment_proofs" NEVER validates a payment and NEVER
--   credits a wallet. Only "validated_payments" represents a verified payment.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  file_hash TEXT NOT NULL,
  perceptual_hash TEXT NULL,
  transcode TEXT NULL,
  detected_amount NUMERIC(18, 2) NULL,
  detected_method TEXT NULL,
  detected_datetime TIMESTAMPTZ NULL,
  ocr_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  fraud_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  verification_status TEXT NOT NULL DEFAULT 'received',
  rejection_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Domain & Integrity Constraints:
  CONSTRAINT chk_payment_proofs_file_hash_non_empty
    CHECK (length(trim(file_hash)) >= 16),
  CONSTRAINT chk_payment_proofs_detected_amount_non_negative
    CHECK (detected_amount IS NULL OR detected_amount >= 0),
  CONSTRAINT chk_payment_proofs_detected_method
    CHECK (detected_method IS NULL OR detected_method IN ('moncash', 'natcash')),
  CONSTRAINT chk_payment_proofs_fraud_score_range
    CHECK (fraud_score >= 0 AND fraud_score <= 100),
  CONSTRAINT chk_payment_proofs_verification_status
    CHECK (verification_status IN (
      'received',
      'pending',
      'verifying',
      'verified',
      'credited',
      'rejected',
      'manual_review'
    )),

  -- Mandatory Uniqueness Constraint on Screenshot File Hash:
  -- The exact same screenshot image can never be uploaded twice across the platform
  CONSTRAINT uq_payment_proofs_file_hash
    UNIQUE (file_hash)
);

-- Conditional Uniqueness Rule 1 on "payment_proofs":
-- At most ONE proof per payment_request_id can ever reach a verified/credited state
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_one_verified_per_request
  ON payment_proofs (payment_request_id)
  WHERE verification_status IN ('verified', 'credited');

-- Conditional Uniqueness Rule 2 on "payment_proofs":
-- A transcode in payment_proofs is only locked for uniqueness when verified/credited,
-- so a fraudulent/rejected attempt with a fake screenshot cannot DoS a legitimate transcode
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_proofs_validated_transcode
  ON payment_proofs (transcode)
  WHERE verification_status IN ('verified', 'credited')
    AND transcode IS NOT NULL
    AND length(trim(transcode)) > 0;

CREATE INDEX IF NOT EXISTS idx_payment_proofs_payment_request_id
  ON payment_proofs (payment_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_user_id
  ON payment_proofs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_transcode_lookup
  ON payment_proofs (transcode)
  WHERE transcode IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Table "validated_payments" (Truly Validated Payments — Strict Separation)
-- -----------------------------------------------------------------------------
-- IMPORTANT:
--   A record is inserted into "validated_payments" ONLY after backend OCR,
--   exact transcode match, exact expected_amount match, payment_method match,
--   image forensic check, and 2FA verification (or manual admin validation)
--   have all succeeded.
--   Enforces 1-to-1 uniqueness with payment_requests, payment_proofs, and transcode.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validated_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  payment_proof_id UUID NOT NULL REFERENCES payment_proofs(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL,
  transcode TEXT NOT NULL,
  validated_amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  validation_source TEXT NOT NULL DEFAULT 'ocr_antifraud',
  validated_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'validated',
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Domain & Integrity Constraints:
  CONSTRAINT chk_validated_payments_method
    CHECK (payment_method IN ('moncash', 'natcash')),
  CONSTRAINT chk_validated_payments_transcode_non_empty
    CHECK (length(trim(transcode)) >= 6),
  CONSTRAINT chk_validated_payments_amount_positive
    CHECK (validated_amount > 0),
  CONSTRAINT chk_validated_payments_currency
    CHECK (currency IN ('HTG', 'USD')),
  CONSTRAINT chk_validated_payments_source
    CHECK (validation_source IN ('ocr_antifraud', 'manual_admin')),
  CONSTRAINT chk_validated_payments_status
    CHECK (status IN ('validated', 'credited', 'refunded', 'revoked')),

  -- Strict Uniqueness Guarantees:
  -- 1. One payment_request can never be validated more than once
  CONSTRAINT uq_validated_payments_payment_request
    UNIQUE (payment_request_id),
  -- 2. One payment_proof can never validate more than one payment
  CONSTRAINT uq_validated_payments_payment_proof
    UNIQUE (payment_proof_id),
  -- 3. One transcode can never be validated more than once globally
  CONSTRAINT uq_validated_payments_transcode
    UNIQUE (transcode),
  -- 4. Composite uniqueness on (payment_method, transcode)
  CONSTRAINT uq_validated_payments_method_transcode
    UNIQUE (payment_method, transcode)
);

-- Conditional Uniqueness Index on active validated transcodes
CREATE UNIQUE INDEX IF NOT EXISTS uq_validated_payments_active_transcode
  ON validated_payments (transcode)
  WHERE status IN ('validated', 'credited');

CREATE INDEX IF NOT EXISTS idx_validated_payments_user_id
  ON validated_payments (user_id, validated_at DESC);

CREATE INDEX IF NOT EXISTS idx_validated_payments_status
  ON validated_payments (status, validated_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Table "wallet_transactions" (Immutable Financial Ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_request_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  validated_payment_id UUID NULL REFERENCES validated_payments(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status TEXT NOT NULL DEFAULT 'completed',
  idempotency_key TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Domain & Integrity Constraints:
  CONSTRAINT chk_wallet_transactions_type
    CHECK (type IN ('deposit', 'debit', 'refund', 'adjustment')),
  CONSTRAINT chk_wallet_transactions_amount_positive
    CHECK (amount > 0),
  CONSTRAINT chk_wallet_transactions_currency
    CHECK (currency IN ('HTG', 'USD')),
  CONSTRAINT chk_wallet_transactions_status
    CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  -- Every deposit or refund transaction MUST reference a payment_request_id
  CONSTRAINT chk_wallet_transactions_payment_request_required_for_deposit_refund
    CHECK (type NOT IN ('deposit', 'refund') OR payment_request_id IS NOT NULL),

  -- Mandatory Uniqueness Constraints:
  CONSTRAINT uq_wallet_transactions_idempotency_key
    UNIQUE (idempotency_key),
  CONSTRAINT uq_wallet_transactions_reference
    UNIQUE (reference)
);

-- Conditional Uniqueness Rule 1: Maximum 1 completed deposit per payment_request_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_deposit_per_payment
  ON wallet_transactions (payment_request_id)
  WHERE type = 'deposit'
    AND status = 'completed'
    AND payment_request_id IS NOT NULL;

-- Conditional Uniqueness Rule 2: Maximum 1 completed deposit per validated_payment_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_deposit_per_validated_payment
  ON wallet_transactions (validated_payment_id)
  WHERE type = 'deposit'
    AND status = 'completed'
    AND validated_payment_id IS NOT NULL;

-- Conditional Uniqueness Rule 3: Maximum 1 completed refund per payment_request_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_transactions_single_refund_per_payment
  ON wallet_transactions (payment_request_id)
  WHERE type = 'refund'
    AND status = 'completed'
    AND payment_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id
  ON wallet_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_payment_request_id
  ON wallet_transactions (payment_request_id)
  WHERE payment_request_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Table "idempotency_keys" (Anti-Replay & Request Deduplication Lock Table)
-- -----------------------------------------------------------------------------
-- Explicit relations:
--   users.id            -> idempotency_keys.user_id     (ON DELETE RESTRICT)
--   payment_requests.id -> idempotency_keys.resource_id (ON DELETE RESTRICT, when applicable)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NULL,
  response_body JSONB NULL,
  resource_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'processing',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,

  -- Domain & Integrity Constraints:
  CONSTRAINT chk_idempotency_keys_status
    CHECK (status IN ('processing', 'completed', 'failed')),
  CONSTRAINT chk_idempotency_keys_completed_metadata
    CHECK (status <> 'completed' OR (response_status IS NOT NULL AND completed_at IS NOT NULL)),

  -- Mandatory Composite Uniqueness Constraint:
  CONSTRAINT uq_idempotency_keys_user_endpoint_key
    UNIQUE (user_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_resource_id
  ON idempotency_keys (resource_id)
  WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys (expires_at);

-- -----------------------------------------------------------------------------
-- 7. Table "audit_logs" & Financial Security Audit Tables
-- -----------------------------------------------------------------------------
-- Every audit table references users(id) ON DELETE RESTRICT when available
-- and payment_requests(id) ON DELETE RESTRICT when applicable.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_request_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  idempotency_key TEXT NULL,
  request_id TEXT NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_payment_request_id
  ON audit_logs (payment_request_id, created_at DESC)
  WHERE payment_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs (resource_type, resource_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id UUID NULL,
  event_type TEXT NOT NULL,
  payment_method TEXT NULL CHECK (payment_method IS NULL OR payment_method IN ('moncash', 'natcash')),
  expected_amount NUMERIC(18, 2) NULL,
  detected_amount NUMERIC(18, 2) NULL,
  detected_transcode_masked TEXT NULL,
  entered_transcode_masked TEXT NULL,
  proof_hash TEXT NULL,
  anti_fraud_decision TEXT NULL,
  status_after TEXT NULL,
  summary TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  immutable_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_payment_request_id
  ON payment_audit_logs (payment_request_id, created_at DESC)
  WHERE payment_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_audit_logs_user_id
  ON payment_audit_logs (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_antifraud_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  payment_proof_id UUID NULL REFERENCES payment_proofs(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
  expected_amount NUMERIC(18, 2) NOT NULL CHECK (expected_amount > 0),
  detected_amount NUMERIC(18, 2) NULL,
  detected_transcode TEXT NULL,
  entered_transcode TEXT NULL,
  proof_hash TEXT NULL,
  duplicate_of_request_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  risk_score NUMERIC(5, 2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  decision TEXT NOT NULL CHECK (decision IN ('AUTO_APPROVED', 'AUTO_REJECTED', 'MANUAL_REVIEW')),
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  anomalies_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_antifraud_incidents_user_id
  ON payment_antifraud_incidents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_antifraud_incidents_payment_request_id
  ON payment_antifraud_incidents (payment_request_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 8. Table "wallet_2fa_challenges" (Blocking SMS/Email 2FA Verification Gate)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_2fa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_request_id UUID NULL REFERENCES payment_requests(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('wallet_credit', 'wallet_withdrawal')),
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  destination TEXT NOT NULL,
  masked_destination TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'HTG' CHECK (currency IN ('HTG', 'USD')),
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'verified', 'consumed', 'expired', 'locked')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  verification_token TEXT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_2fa_challenges_user_op
  ON wallet_2fa_challenges (user_id, operation_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_2fa_challenges_payment_request
  ON wallet_2fa_challenges (payment_request_id)
  WHERE payment_request_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9. Trigger: Enforce Proof vs Validated Payment Separation & Integrity
-- -----------------------------------------------------------------------------
-- Ensures that:
--   1. A "validated_payments" row can only be created if its "payment_proof_id"
--      belongs to the exact same "payment_request_id" and "user_id".
--   2. The "validated_amount" and "payment_method" match "payment_requests".
--   3. A "wallet_transactions" deposit can NEVER be created from a raw proof
--      without a verified row in "validated_payments".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_validated_payment_integrity()
RETURNS TRIGGER AS $$
DECLARE
  v_req RECORD;
  v_proof RECORD;
BEGIN
  SELECT id, user_id, payment_method, expected_amount, currency, status
    INTO v_req
    FROM payment_requests
   WHERE id = NEW.payment_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: payment_request (%) does not exist', NEW.payment_request_id;
  END IF;

  IF v_req.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: validated_payment user_id (%) does not match payment_request user_id (%)', NEW.user_id, v_req.user_id;
  END IF;

  IF v_req.payment_method <> NEW.payment_method THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: validated_payment method (%) does not match payment_request method (%)', NEW.payment_method, v_req.payment_method;
  END IF;

  IF v_req.expected_amount <> NEW.validated_amount THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: validated_amount (%) does not match expected_amount (%)', NEW.validated_amount, v_req.expected_amount;
  END IF;

  IF v_req.status IN ('rejected', 'refunded', 'expired') THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: cannot validate payment_request (%) in terminal status %', NEW.payment_request_id, v_req.status;
  END IF;

  SELECT id, payment_request_id, user_id
    INTO v_proof
    FROM payment_proofs
   WHERE id = NEW.payment_proof_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: payment_proof (%) does not exist', NEW.payment_proof_id;
  END IF;

  IF v_proof.payment_request_id <> NEW.payment_request_id OR v_proof.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'INTEGRITY_VIOLATION: payment_proof (%) does not belong to payment_request (%) and user (%)',
      NEW.payment_proof_id, NEW.payment_request_id, NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_validated_payment_integrity ON validated_payments;
CREATE TRIGGER trg_enforce_validated_payment_integrity
  BEFORE INSERT OR UPDATE ON validated_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_validated_payment_integrity();

CREATE OR REPLACE FUNCTION require_validated_payment_before_wallet_deposit()
RETURNS TRIGGER AS $$
DECLARE
  v_validated RECORD;
BEGIN
  IF NEW.type = 'deposit' THEN
    IF NEW.payment_request_id IS NULL THEN
      RAISE EXCEPTION 'SEPARATION_VIOLATION: wallet deposit requires a valid payment_request_id';
    END IF;

    SELECT id, user_id, validated_amount, status
      INTO v_validated
      FROM validated_payments
     WHERE payment_request_id = NEW.payment_request_id
       AND status IN ('validated', 'credited');

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SEPARATION_VIOLATION: cannot credit wallet for payment_request (%) because no validated_payments record exists (a received payment_proof is never a validated payment)',
        NEW.payment_request_id;
    END IF;

    IF v_validated.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'SEPARATION_VIOLATION: wallet deposit user_id (%) does not match validated_payment user_id (%)',
        NEW.user_id, v_validated.user_id;
    END IF;

    IF NEW.validated_payment_id IS NULL THEN
      NEW.validated_payment_id := v_validated.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_require_validated_payment_before_wallet_deposit ON wallet_transactions;
CREATE TRIGGER trg_require_validated_payment_before_wallet_deposit
  BEFORE INSERT ON wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION require_validated_payment_before_wallet_deposit();

-- -----------------------------------------------------------------------------
-- 10. Trigger: Strict State Machine Enforcement on "payment_requests"
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_payment_request_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- A transaction already "credited" can ONLY transition to "refunded"
  IF OLD.status = 'credited' AND NEW.status <> 'refunded' THEN
    RAISE EXCEPTION 'STATE_MACHINE_VIOLATION: credited payment (%) cannot transition to %', OLD.id, NEW.status;
  END IF;

  -- Terminal states cannot transition to any other state
  IF OLD.status IN ('rejected', 'refunded', 'expired') THEN
    RAISE EXCEPTION 'STATE_MACHINE_VIOLATION: terminal payment (%) in status % cannot transition to %', OLD.id, OLD.status, NEW.status;
  END IF;

  -- A transaction in "manual_review" can never return to "pending" or "verifying"
  IF OLD.status = 'manual_review' AND NEW.status IN ('pending', 'verifying') THEN
    RAISE EXCEPTION 'STATE_MACHINE_VIOLATION: manual_review payment (%) cannot revert to %', OLD.id, NEW.status;
  END IF;

  -- A transaction in "verified" can only move to "credited" or "rejected"
  IF OLD.status = 'verified' AND NEW.status NOT IN ('credited', 'rejected') THEN
    RAISE EXCEPTION 'STATE_MACHINE_VIOLATION: verified payment (%) cannot transition to %', OLD.id, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payment_request_state ON payment_requests;
CREATE TRIGGER trg_enforce_payment_request_state
  BEFORE UPDATE ON payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_request_state_transition();

-- -----------------------------------------------------------------------------
-- 11. Trigger: Prevent Silent Deletion of Financial & Audit History
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_financial_history_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'FINANCIAL_HISTORY_IMMUTABLE: deletion is strictly forbidden on table % (record id: %)', TG_TABLE_NAME, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_delete_payment_requests ON payment_requests;
CREATE TRIGGER trg_no_delete_payment_requests
  BEFORE DELETE ON payment_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_no_delete_payment_proofs ON payment_proofs;
CREATE TRIGGER trg_no_delete_payment_proofs
  BEFORE DELETE ON payment_proofs
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_no_delete_validated_payments ON validated_payments;
CREATE TRIGGER trg_no_delete_validated_payments
  BEFORE DELETE ON validated_payments
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_no_delete_wallet_transactions ON wallet_transactions;
CREATE TRIGGER trg_no_delete_wallet_transactions
  BEFORE DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_no_delete_audit_logs ON audit_logs;
CREATE TRIGGER trg_no_delete_audit_logs
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_history_deletion();
