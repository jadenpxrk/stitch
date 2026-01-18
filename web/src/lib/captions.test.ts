import { describe, it, expect } from "vitest";
import { filterFillerWords } from "./captions";

describe("filterFillerWords", () => {
  it("should remove common filler words", () => {
    const segments = [
      { start: 0, end: 1, text: "So umm I was thinking" },
      { start: 1, end: 2, text: "You know uh about this" },
    ];

    const result = filterFillerWords(segments);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("So I was thinking");
    expect(result[1].text).toBe("You know about this");
  });

  it("should preserve timestamps when filtering", () => {
    const segments = [
      { start: 5.5, end: 7.2, text: "umm hello there" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].start).toBe(5.5);
    expect(result[0].end).toBe(7.2);
    expect(result[0].text).toBe("hello there");
  });

  it("should remove standalone 'like' as filler", () => {
    const segments = [
      { start: 0, end: 1, text: "It was like really good" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("It was really good");
  });

  it("should keep 'like' when preceded by 'I'", () => {
    const segments = [
      { start: 0, end: 1, text: "I like this a lot" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("I like this a lot");
  });

  it("should keep 'like' when followed by 'this' or 'that'", () => {
    const segments = [
      { start: 0, end: 1, text: "Something like this works" },
      { start: 1, end: 2, text: "It looks like that one" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("Something like this works");
    expect(result[1].text).toBe("It looks like that one");
  });

  it("should drop segments that become empty after filtering", () => {
    const segments = [
      { start: 0, end: 1, text: "umm uh" },
      { start: 1, end: 2, text: "Hello world" },
      { start: 2, end: 3, text: "er hmm" },
    ];

    const result = filterFillerWords(segments);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Hello world");
  });

  it("should normalize whitespace after removal", () => {
    const segments = [
      { start: 0, end: 1, text: "So  umm   I   uh   was" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("So I was");
  });

  it("should handle multiple filler words in sequence", () => {
    const segments = [
      { start: 0, end: 1, text: "umm uh er well hello" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("well hello");
  });

  it("should handle empty input", () => {
    const result = filterFillerWords([]);
    expect(result).toHaveLength(0);
  });

  it("should be case insensitive for filler words", () => {
    const segments = [
      { start: 0, end: 1, text: "UMM hello UH there" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("hello there");
  });

  it("should handle filler words with punctuation", () => {
    const segments = [
      { start: 0, end: 1, text: "So, umm, I think" },
    ];

    const result = filterFillerWords(segments);

    expect(result[0].text).toBe("So, I think");
  });
});
