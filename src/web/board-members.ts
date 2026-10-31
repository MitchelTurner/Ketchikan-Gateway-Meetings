/**
 * Last names of the people who vote on each body, in the order published
 * on that body's own page. This is the standing board, not who was in the
 * room for one meeting. A body with no complete published roster is omitted
 * rather than guessed: service-area boards, the port board, and city committees.
 *
 * Assembly — kgbak.us/173/Mayor-and-Assembly. The mayor and seven members
 * are all elected at large and all vote.
 * School Board — kgbsd.org school-board page. Seven elected members.
 * Chloe Hall is the board clerk and does not vote.
 * Planning Commission — seven seats. Same names the recap already checks
 * spellings against, and the same seven on the Sept 29, 2026 roll call.
 * The commission page describes the seats but does not print the names.
 * City Council — ketchikan.gov/contact-us, after the Oct 6, 2026 election.
 * The mayor votes with the seven councilmembers.
 */
const VOTERS: Record<string, readonly string[]> = {
  Assembly: ['Otos', 'Ortiz', 'Mattson', 'Dial', 'Arntzen', 'Palmer', 'Bolling', 'Thompson'],
  'School Board': ['Reed', 'Johnson', 'Montgomery', 'Tabb', 'Ginter', 'Medford', 'Klein'],
  'Planning Commission': ['Govaars', 'Shaw', 'Turner', 'Gubatayao', 'Dollimont-Svenson', 'Arnold', 'Gage'],
  'City Council': ['Sivertsen', 'Coose', 'Gass', 'Bradberry', 'Finnegan', 'Zenge', 'Gage', 'Strassburg'],
};

/** Last names, or an empty list when this body has no published voting roster. */
export function boardVoters(body: string): string[] {
  const names = VOTERS[body];
  return names ? [...names] : [];
}
