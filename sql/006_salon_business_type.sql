-- 006_salon_business_type.sql
-- Adds multi-business-type support (restaurant + salon)
-- Run on Aurora PostgreSQL, then: npx prisma db pull && npx prisma generate

-- 1. Business type on tenant (all existing tenants remain 'restaurant')
ALTER TABLE tenants ADD COLUMN business_type VARCHAR(20) NOT NULL DEFAULT 'restaurant';

-- 2. Service fields on products (duration for timed services, technician requirement)
ALTER TABLE products
  ADD COLUMN duration_minutes INT DEFAULT NULL,
  ADD COLUMN requires_technician BOOLEAN DEFAULT false;

-- 3. Technician fields on memberships (specialties = array of product IDs they can perform)
ALTER TABLE memberships
  ADD COLUMN specialties TEXT[] DEFAULT '{}',
  ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT NULL;

-- 4. Appointment scheduling on order_items (each item can have its own technician + time)
ALTER TABLE order_items
  ADD COLUMN technician_id UUID REFERENCES memberships(id),
  ADD COLUMN scheduled_start TIMESTAMPTZ,
  ADD COLUMN scheduled_end TIMESTAMPTZ;

CREATE INDEX idx_order_items_technician ON order_items(technician_id) WHERE technician_id IS NOT NULL;
CREATE INDEX idx_order_items_schedule ON order_items(scheduled_start, scheduled_end) WHERE scheduled_start IS NOT NULL;

-- 5. Appointment date/time on orders
ALTER TABLE orders
  ADD COLUMN appointment_date DATE,
  ADD COLUMN appointment_time VARCHAR(5);

CREATE INDEX idx_orders_appointment ON orders(appointment_date) WHERE appointment_date IS NOT NULL;

-- 6. Add APPOINTMENT to OrderType enum (cannot be in transaction)
ALTER TYPE "OrderType" ADD VALUE 'APPOINTMENT';

-- 7. Salon-specific tenant settings
ALTER TABLE tenant_settings
  ADD COLUMN appointment_booking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN buffer_time_minutes INT DEFAULT 15,
  ADD COLUMN booking_advance_days INT DEFAULT 30,
  ADD COLUMN walk_in_enabled BOOLEAN DEFAULT true;
