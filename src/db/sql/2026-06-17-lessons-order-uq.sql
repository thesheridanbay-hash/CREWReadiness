-- Unique (unit_id, order) on lessons.
--
-- Parity with lesson_items (which has lesson_items_lesson_order_uq), and the
-- backstop that moveLesson's temporary-negative-order swap assumes: with this
-- index a bad concurrent interleaving raises a unique violation and rolls back
-- instead of silently committing duplicate orders. Orders are already unique
-- per unit (assigned via nextOrder), so this is non-destructive. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS lessons_unit_order_uq ON lessons (unit_id, "order");
