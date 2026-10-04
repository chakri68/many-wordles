import { makeClueVariant } from './engine';

export default makeClueVariant({
  id: 'define',
  pool: 'define',
  name: 'Define',
  style: 'definition',
  placeholder: 'the word being defined',
  tagline: 'A definition, one fragment at a time. Name the word.',
  rulesHtml: `
    <p>A word's definition arrives in pieces, <b>vaguest first</b>. Each wrong guess
    (or skip) adds the next piece.</p>
    <p>Name the word within <b>6</b> misses. The tiles up top show its length.</p>`,
});
