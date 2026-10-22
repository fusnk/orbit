import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SUBS, DEFAULT_MODELS, DEFAULT_SERVER, errorMessage, parseAiSubs, progressText, targetLanguage, translateArgs } from './subtitle-translate';

const JUNK: unknown[] = [null, undefined, 0, '', 'junk', true, [], {}, { provider: 'anthropic', models: 'x', server: 42, target: 'klingon' }, JSON.parse('{"__proto__": {"provider": "openai"}}')];

describe('AI subtitle translation', () => {
  it('falls back to its defaults on junk (a hand-edited backup)', () => {
    for (const junk of JUNK) expect(parseAiSubs(junk)).toEqual(DEFAULT_AI_SUBS);
    expect(DEFAULT_AI_SUBS.provider).toBe('local');
    expect(DEFAULT_AI_SUBS.server).toBe(DEFAULT_SERVER);
  });

  it('keeps good values field by field, and a model per service', () => {
    const prefs = parseAiSubs({ provider: 'gemini', models: { gemini: ' my-model ', openai: 7 }, server: 'http://localhost:11434/v1', target: 'fr' });
    expect(prefs).toEqual({ provider: 'gemini', models: { ...DEFAULT_MODELS, gemini: 'my-model' }, server: 'http://localhost:11434/v1', target: 'fr' });
    expect(parseAiSubs({ models: { local: 'x'.repeat(129) } }).models.local).toBe(DEFAULT_MODELS.local);
  });

  it('offers Claude, starting on Haiku and keeping another model chosen', () => {
    expect(DEFAULT_MODELS.claude).toBe('claude-haiku-5-5');
    const prefs = parseAiSubs({ provider: 'claude', models: { claude: 'claude-sonnet-5-5' } });
    expect(translateArgs(prefs, (n) => n).config).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5', server: '' });
    expect(translateArgs(parseAiSubs({ provider: 'claude' }), (n) => n).config.model).toBe('claude-haiku-5-5');
  });

  it('sends Rust the service, the model and the language’s English name', () => {
    const args = translateArgs(parseAiSubs({ provider: 'openai', target: 'es', server: 'http://127.0.0.1:9/v1' }), (name) => `${name} (AI)`);
    expect(args.config).toEqual({ provider: 'openai', model: DEFAULT_MODELS.openai, server: '' });
    expect(args.target).toEqual({ name: 'Spanish', code: 'es' });
    expect(args.label).toBe('Spanish (AI)');
    expect(translateArgs(parseAiSubs({ target: 'de' }), (n) => n).config.server).toBe(DEFAULT_SERVER);
    // No choice: the app's language (English in tests).
    expect(targetLanguage(DEFAULT_AI_SUBS)).toBe('en');
  });

  it('turns Rust’s error codes into messages, and stays quiet when cancelled', () => {
    expect(errorMessage('no-key')).toContain('API key');
    expect(errorMessage('not-local')).toContain('127.0.0.1');
    expect(errorMessage('unreachable')).toContain('running');
    expect(errorMessage('overloaded')).toContain('overloaded');
    expect(errorMessage('cancelled')).toBeNull();
    expect(errorMessage('toString')).toBe(errorMessage(new Error('x')));
    expect(errorMessage(undefined)).toBe('Translating didn’t work.');
  });

  it('shows progress by batches done', () => {
    expect(progressText(0, 0)).toBe('Starting the translation…');
    expect(progressText(3, 8)).toBe('Translating… 38%');
  });
});
