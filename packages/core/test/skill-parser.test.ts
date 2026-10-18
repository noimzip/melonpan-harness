import { describe, it, expect } from 'vitest';
import { SkillParser } from '../src/skills/skill-parser.js';

describe('SkillParser (Agent Skills Specification)', () => {
  const validSkill = `---
name: game-generator
description: Generates high-quality HTML5 Canvas games. Use when user wants a game.
license: MIT
metadata:
  version: "1.0.0"
  target: "canvas-2d"
---

# Instructions
You are an expert game developer.
`.trim();

  it('parses valid SKILL.md Frontmatter and body', () => {
    const parsed = SkillParser.parse(validSkill, 'game-generator');
    expect(parsed.frontmatter.name).toBe('game-generator');
    expect(parsed.frontmatter.description).toContain('Generates high-quality HTML5 Canvas games');
    expect(parsed.frontmatter.license).toBe('MIT');
    expect(parsed.frontmatter.metadata?.version).toBe('1.0.0');
    expect(parsed.body).toBe('# Instructions\nYou are an expert game developer.');
  });

  it('rejects skill name with uppercase letters', () => {
    const invalidName = `---
name: Game-Generator
description: Valid description
---
Body
`;
    expect(() => SkillParser.parse(invalidName)).toThrow(/lowercase alphanumeric/);
  });

  it('rejects skill name with consecutive hyphens', () => {
    const invalidName = `---
name: game--generator
description: Valid description
---
Body
`;
    expect(() => SkillParser.parse(invalidName)).toThrow(/lowercase alphanumeric/);
  });

  it('rejects skill name mismatch with parent directory name', () => {
    expect(() => SkillParser.parse(validSkill, 'other-dir')).toThrow(
      /must match parent directory name/
    );
  });

  it('rejects empty or missing description', () => {
    const noDesc = `---
name: my-skill
description: ""
---
Body
`;
    expect(() => SkillParser.parse(noDesc)).toThrow(/non-empty/);
  });

  it('rejects file without opening "---"', () => {
    const noDelim = `name: test\ndescription: test\n`;
    expect(() => SkillParser.parse(noDelim)).toThrow(/must start with YAML frontmatter delimiter/);
  });
});
