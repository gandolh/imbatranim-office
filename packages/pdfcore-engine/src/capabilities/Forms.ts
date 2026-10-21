import type { Rect } from "../api/types.js";

/** The AcroForm field types the engine understands (DEC-38). */
export type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox"
  | "signature";

/** A value settable on a field: string (text/choice), boolean (checkbox),
 *  or string[] (multi-select listbox). */
export type FieldValue = string | boolean | string[];

/**
 * Everything a consumer UI needs to render and edit one AcroForm field.
 * `rect` is the widget geometry in PDF user space (merged in from pdf.js widget
 * annotations by the Forms adapter, brief 13).
 */
export interface FieldInfo {
  /** Fully-qualified field name. */
  name: string;
  /** Field type. */
  type: FieldType;
  /** 1-based page index the widget is on (first widget if multiple). */
  page: number;
  /** Widget rectangle in PDF user space. */
  rect: Rect;
  /** Current value (type depends on `type`). */
  value: FieldValue;
  /** Allowed options for choice fields (dropdown/listbox/radio). */
  options?: string[];
  /** Field is read-only. */
  readonly: boolean;
  /** Field is required. */
  required: boolean;
}

/**
 * Forms — enumerate AcroForm fields, read/set values, and flatten. Backed by
 * `pdf-lib` (read/write) with `pdfjs-dist` supplying widget geometry.
 *
 * Platform: **common**. Implemented by **brief 13**.
 */
export interface Forms {
  /** All fields with type, page, geometry, value, options and flags. */
  list(): FieldInfo[];

  /** One field by name, or `undefined` if absent. */
  get(name: string): FieldInfo | undefined;

  /**
   * Set a field's value. Throws for unknown names or invalid option values.
   * @param name field name.
   * @param value string (text/choice), boolean (checkbox), or string[] (listbox).
   */
  set(name: string, value: FieldValue): void;

  /**
   * Bake current values into page content and remove the interactive widgets.
   * @param names optional subset; omit to flatten every field.
   */
  flatten(names?: string[]): void;
}
