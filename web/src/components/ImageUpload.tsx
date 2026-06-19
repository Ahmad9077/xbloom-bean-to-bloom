import { useEffect, useRef, useState } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

function validateFile(f: File): string | null {
  if (!ACCEPTED_TYPES.includes(f.type)) {
    return "Unsupported format. Please upload a JPEG, PNG, or WebP image.";
  }
  if (f.size === 0) {
    return "The file appears to be empty.";
  }
  if (f.size > MAX_BYTES) {
    return `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`;
  }
  return null;
}

export default function ImageUpload({ file, onChange, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Derive preview URL from the file prop so external file changes are reflected.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function accept(f: File) {
    const msg = validateFile(f);
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    onChange(f);
  }

  function clear() {
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) accept(picked);
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files[0];
    if (dropped) accept(dropped);
  }

  return (
    <div className="space-y-3">
      {file && previewUrl ? (
        <div className="relative rounded-card overflow-hidden border border-espresso/10">
          <img src={previewUrl} alt="Selected coffee bag" className="w-full h-48 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-espresso/60 to-transparent flex items-end p-3 gap-2">
            <span className="text-ivory text-xs font-semibold truncate flex-1">{file.name}</span>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="text-xs text-ivory/80 hover:text-ivory underline focus-visible:outline-2 focus-visible:outline-ivory"
              aria-label="Remove photo and choose another"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label="Upload a coffee bag photo — JPEG, PNG, or WebP up to 10 MB"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`w-full border-2 border-dashed rounded-card p-8 flex flex-col items-center gap-3
                      cursor-pointer transition-colors min-h-[160px] justify-center
                      ${dragging ? "border-terracotta bg-terracotta/5" : "border-espresso/20 bg-ivory hover:border-espresso/40"}
                      ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta
                      `}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-sage"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <div className="text-center">
            <p className="text-sm font-semibold text-espresso">Tap to choose or drag a photo</p>
            <p className="text-xs text-sage mt-1">JPEG · PNG · WebP · up to 10 MB</p>
          </div>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleInput}
        disabled={disabled}
        aria-label="Choose a coffee bag photo"
        capture="environment"
      />

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
