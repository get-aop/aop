/**
 * Handler function that processes output data records.
 * @param data - Parsed JSON data
 * @param rawLine - Original JSON string (avoids re-serialization when writing to file)
 */
export type OutputHandler = (data: Record<string, unknown>, rawLine?: string) => void;
