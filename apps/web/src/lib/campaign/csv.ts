/**
 * Parse CSV text into rows of string cells.
 * Handles RFC 4180 quoting (values wrapped in double-quotes, escaped as "").
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        // Quoted cell
        let cell = "";
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            cell += line[i++];
          }
        }
        if (i < line.length && line[i] === ',') i++; // skip comma
        cells.push(cell);
      } else {
        // Unquoted cell
        const end = line.indexOf(',', i);
        if (end === -1) {
          cells.push(line.slice(i));
          break;
        } else {
          cells.push(line.slice(i, end));
          i = end + 1;
        }
      }
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Normalize a CSV header to canonical form.
 * Lowercases and strips whitespace, then maps aliases to canonical names.
 */
export function normalizeCsvHeader(value: string): string {
  const v = value.trim().toLowerCase().replace(/[_\s-]/g, "");
  const aliases: Record<string, string> = {
    beneficiary: "beneficiary",
    recipient: "beneficiary",
    wallet: "beneficiary",
    address: "beneficiary",
    amount: "amount",
    releasetype: "releaseType",
    type: "releaseType",
    starttime: "startTime",
    start: "startTime",
    cliffrime: "cliffTime", // handle typo variants
    clifftime: "cliffTime",
    cliff: "cliffTime",
    unlocktime: "cliffTime",
    endtime: "endTime",
    end: "endTime",
    milestoneidx: "milestoneIdx",
    milestone: "milestoneIdx",
  };
  return aliases[v] ?? value.trim();
}
