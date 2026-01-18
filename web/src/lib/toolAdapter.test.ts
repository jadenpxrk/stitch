import { describe, it, expect, beforeEach } from "vitest";
import {
  hasCapability,
  listCapabilities,
  describeCapability,
} from "./toolAdapter";

describe("toolAdapter", () => {
  describe("hasCapability", () => {
    it("should return true for registered capabilities", () => {
      expect(hasCapability("trim_intro")).toBe(true);
      expect(hasCapability("generate_captions")).toBe(true);
      expect(hasCapability("stabilize_segment")).toBe(true);
      expect(hasCapability("cut_segment")).toBe(true);
      expect(hasCapability("bridge_segments")).toBe(true);
      expect(hasCapability("export_video")).toBe(true);
    });
  });

  describe("listCapabilities", () => {
    it("should return all registered capabilities", () => {
      const capabilities = listCapabilities();

      expect(capabilities).toContain("trim_intro");
      expect(capabilities).toContain("generate_captions");
      expect(capabilities).toContain("stabilize_segment");
      expect(capabilities).toContain("cut_segment");
      expect(capabilities).toContain("bridge_segments");
      expect(capabilities).toContain("export_video");
    });

    it("should return an array", () => {
      const capabilities = listCapabilities();
      expect(Array.isArray(capabilities)).toBe(true);
    });
  });

  describe("describeCapability", () => {
    it("should return description for trim_intro", () => {
      const desc = describeCapability("trim_intro");
      expect(desc).toContain("beginning");
      expect(desc).toContain("learned");
    });

    it("should return description for generate_captions", () => {
      const desc = describeCapability("generate_captions");
      expect(desc).toContain("captions");
      expect(desc).toContain("speech");
    });

    it("should return description for stabilize_segment", () => {
      const desc = describeCapability("stabilize_segment");
      expect(desc).toContain("stabilization");
    });

    it("should return description for cut_segment", () => {
      const desc = describeCapability("cut_segment");
      expect(desc).toContain("Remove");
    });

    it("should return description for bridge_segments", () => {
      const desc = describeCapability("bridge_segments");
      expect(desc).toContain("transition");
    });

    it("should return description for export_video", () => {
      const desc = describeCapability("export_video");
      expect(desc).toContain("Render");
    });
  });
});
