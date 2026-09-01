"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** How the signer is entering their signature. */
export type SignatureMode = "type" | "draw";

export type SignatureFieldProps = {
  /** Typed name when `mode` is "type", or a base64 PNG data URL when "draw". */
  value: string;
  mode: SignatureMode;
  /** Called when the signer switches modes. The caller is expected to clear `value` on switch. */
  onMode: (mode: SignatureMode) => void;
  onChange: (value: string) => void;
  /** Canvas width in px. Also governs the area cleared by the Clear button. */
  width?: number;
  /** Canvas height in px. */
  height?: number;
};

/**
 * Dual-mode signature capture: type a legal name, or draw with a pointer.
 *
 * In draw mode `onChange` fires on pointer-up with the canvas as a base64 PNG data URL. Those URLs are
 * large — callers persisting them to localStorage should expect quota pressure.
 *
 * ```tsx
 * <SignatureField
 *   value={form.requestorSignature}
 *   mode={form.signatureMode}
 *   onMode={mode => update({ signatureMode: mode, requestorSignature: "" })}
 *   onChange={value => update({ requestorSignature: value })}
 * />
 * ```
 */
export function SignatureField({ value, mode, onMode, onChange, width = 520, height = 100 }: SignatureFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#172c28";
    context.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    context.stroke();
  };

  return (
    <div className="signatureField">
      <div>
        <strong>Digital Signature</strong>
        <button type="button" className={mode === "type" ? "active" : ""} onClick={() => onMode("type")}>
          Type
        </button>
        <button type="button" className={mode === "draw" ? "active" : ""} onClick={() => onMode("draw")}>
          Draw
        </button>
      </div>
      {mode === "type" ? (
        <input
          className="typedSignature"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="Type your legal name"
        />
      ) : (
        <>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            onPointerDown={event => {
              drawing.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              const context = event.currentTarget.getContext("2d");
              context?.beginPath();
              context?.moveTo(event.nativeEvent.offsetX, event.nativeEvent.offsetY);
            }}
            onPointerMove={event => {
              if (drawing.current) point(event);
            }}
            onPointerUp={event => {
              drawing.current = false;
              onChange(event.currentTarget.toDataURL());
            }}
          />
          <button
            type="button"
            className="clearSignature"
            onClick={() => {
              canvasRef.current?.getContext("2d")?.clearRect(0, 0, width, height);
              onChange("");
            }}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
