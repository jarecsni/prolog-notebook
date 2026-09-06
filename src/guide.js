/**
 * THE THIRD TIER OF HELP: the story the other two cannot tell (869ewp4xd).
 *
 * The bare screen answers WHICH COMMAND. A command's own screen answers HOW TO
 * CALL IT. Neither can answer what a project looks like, or why you would type
 * `build` with no arguments, and the Captain found that out by asking rather
 * than by reading: "can you review the help screens so as to ensure a user can
 * discover the basic use cases solely by looking at help screens".
 *
 * ONE SOURCE, TWO OUTPUTS. `prolog-notebook guide` prints this, and the man page
 * is generated from it — a second copy of the tour would be a second copy to
 * keep true, and the one nobody reads is always the one that is wrong.
 *
 * WHAT BELONGS HERE: the shape of a project, the loop, and the two facts a
 * reader cannot guess — that a bare command means the whole book, and that the
 * site is a build artefact. What does not: switches. They are one screen away,
 * they change more often than this does, and a tour that lists them is a manual.
 */

/** @typedef {{title: string, lines: string[]}} Section */

/**
 * The tour, in the order somebody meets it.
 *
 * A line indented by two spaces is laid out as typed — a command, or a column —
 * and everything else is prose that may be re-wrapped by whatever renders it.
 * A blank line is a paragraph break. That is the whole format.
 *
 * @type {Section[]}
 */
export const GUIDE = [
  {
    title: 'A project is one book',
    lines: [
      'A chapter is a markdown file with Prolog in it. A book is the chapters',
      'prolog-notebook-index.md lists, and that file sits at the root of your',
      'repository beside prolog-notebook-site/, which is what it builds into.',
      '',
      'The first build writes that index for you, and later builds add the',
      'chapters you name. After that it is yours: the order in it is the order',
      'readers get, headings group chapters into parts, and a link to another',
      'index is a sub-book, nested as deep as you like.',
      '',
      'One book per repository, because a repository can only serve one site:',
      'that is GitHub Pages, not us. Several books live inside it as sub-books.',
    ],
  },
  {
    title: 'The loop',
    lines: [
      '  prolog-notebook new lists.prolog.md    a chapter that has its shape',
      '  ...write it...                         prose, a program cell, a query',
      '  prolog-notebook execute                SWI fills every answer in',
      '  prolog-notebook view                   read it as a reader will',
      '  prolog-notebook build                  write the site',
      '  prolog-notebook publish                push it where a host serves it',
      '',
      'You never hand-write an answer. One that did not come from a run is the',
      'author guessing at what SWI prints, published as though it had run.',
    ],
  },
  {
    title: 'One chapter, or all of them',
    lines: [
      'The operand is a filter: name chapters and the command acts on those,',
      'name none and it acts on the whole book.',
      '',
      '  view      that chapter, in its book      the whole book, live',
      '  execute   those chapters                 every chapter',
      '  clear     those chapters                 every chapter, asking first',
      '  build     those chapters into the site   the whole book, in order',
      '',
      'view and build read your sources every time, so there is no build step to',
      'be behind: reorder the index, reload, and the contents page follows. The',
      'exception is view --built, which serves the site as it stands — the',
      'rehearsal for publish, the one command you cannot take back.',
    ],
  },
  {
    title: 'What a reader gets',
    lines: [
      'A static page with the answers already in it, so it reads with no engine',
      'at all. Press Run and SWI-Prolog — compiled to WebAssembly, about 6 MB,',
      'shared by every page of the site — arrives, and from then on the page is',
      'live: edit the program, consult your own version, and step the solutions',
      'one at a time.',
      '',
      'The stepping is the point. Prolog does not return an answer, it returns',
      'answers on backtracking, and a page that showed a final list would hide',
      'the one thing worth watching.',
    ],
  },
  {
    title: 'What to keep in git',
    lines: [
      'Track your chapters and prolog-notebook-index.md — that file is the book,',
      'and nothing else records the order you chose. The site is a build',
      'artefact, about 55 ms a chapter to rebuild, so prolog-notebook-site/',
      'belongs in .gitignore and publish pushes it to a branch of its own.',
    ],
  },
];

/** A line laid out as typed, rather than prose. */
export const literal = (line) => line.startsWith('  ');

/**
 * The tour as it prints at a terminal.
 *
 * Headings in capitals and the body indented, which is what a reader of `man`
 * has already learnt to skim — and this is the screen that is most likely to be
 * read by somebody looking for one section rather than all five.
 */
export function guideText(sections = GUIDE) {
  const out = ['prolog-notebook — the tour', ''];
  for (const { title, lines } of sections) {
    out.push(title.toUpperCase());
    for (const line of lines) out.push(line === '' ? '' : `  ${line}`);
    out.push('');
  }
  out.push('Every command in full: prolog-notebook --help, or <command> --help.');
  return `${out.join('\n')}\n`;
}
