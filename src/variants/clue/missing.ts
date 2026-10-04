import { makeClueVariant } from './engine';

export default makeClueVariant({
  id: 'missing',
  pool: 'missing',
  name: 'Missing',
  style: 'sentence',
  placeholder: 'the missing word',
  tagline: 'One word is missing from six sentences. Each miss shows another.',
  rulesHtml: `
    <p>Every sentence is missing the <b>same word</b>. You start with one sentence;
    each wrong guess (or skip) reveals the next.</p>
    <p>The sentences start vague and get specific, so the sixth all but says it.
    Find it within <b>6</b> misses.</p>
    <p class="muted">The blank shows how many letters the word has.</p>`,
});
