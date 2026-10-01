/**
 * Migration v16: a reply as the ordered parts its turn produced. Versions 1 to 15 are never
 * edited; a database that applied them only runs this statement.
 *
 * - chat_messages.parts: JSON `TurnPart[]` (prose, tool calls, reasoning, in order) of an
 *   assistant reply that a run wrote. Null on every other row, and on replies stored before
 *   this version: those are read from `content` and the older `activity` (see
 *   project/turn-parts.ts), so no row is rewritten.
 */
export const TURN_PARTS_V16_STATEMENTS: readonly string[] = [
  `ALTER TABLE chat_messages ADD COLUMN parts TEXT`,
];
