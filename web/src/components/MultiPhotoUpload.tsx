import { useEffect, useRef, useState } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_COUNT = 4;

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

function validateFile(f: File): string | null {
  const lowerName = f.name.toLowerCase();
  if (
    f.type === "image/heic" ||
    f.type === "image/heif" ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif")
  ) {
    return "HEIC format is not supported. Please convert to JPEG, PNG, or WebP first.";
  }
  if (!ACCEPTED_TYPES.includes(f.type)) {
    return "Unsupported format. Please use JPEG, PNG, or WebP.";
  }
  if (f.size === 0) {
    return "The file appears to be empty.";
  }
  if (f.size > MAX_BYTES) {
    return `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`;
  }
  return null;
}

function PhotoThumb({
  file,
  index,
  onRemove,
  disabled,
}: {
  file: File;
  index: number;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative rounded-[12px] overflow-hidden border border-espresso/10 aspect-square">
      {previewUrl && (
        <img
          src={previewUrl}
          alt={`${index + 1}: ${file.name}`}
          className="w-full h-full object-cover"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove photo ${index + 1}`}
        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-espresso/70 text-ivory
                   flex items-center justify-center text-xs hover:bg-espresso transition-colors
                   focus-visible:outline-2 focus-visible:outline-ivory disabled:opacity-40"
      >
        ✕
      </button>
    </div>
  );
}

export default function MultiPhotoUpload({ files, onChange, disabled = false }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function addFiles(incoming: File[]) {
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of incoming) {
      const msg = validateFile(f);
      if (msg) {
        errors.push(msg);
      } else {
        valid.push(f);
      }
    }
    if (errors.length > 0) {
      setError(errors[0] ?? null);
    } else {
      setError(null);
    }
    if (valid.length === 0) return;
    const combined = [...files, ...valid].slice(0, MAX_COUNT);
    onChange(combined);
  }

  function handleCameraInput(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (picked) addFiles(Array.from(picked));
    e.target.value = "";
  }

  function handleAlbumInput(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (picked) addFiles(Array.from(picked));
    e.target.value = "";
  }

  function removeFile(index: number) {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  }

  const canAdd = files.length < MAX_COUNT && !disabled;
  const remaining = MAX_COUNT - files.length;

  return (
    <div className="space-y-4">
      {files.length > 0 && (
        <div
          className="grid grid-cols-2 gap-2"
          aria-label={`Selected photos (${files.length} of ${MAX_COUNT})`}
        >
          {files.map((f, i) => (
            <PhotoThumb
              key={`${f.name}-${f.size}-${i}`}
              file={f}
              index={i}
              onRemove={() => removeFile(i)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {canAdd && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            aria-label="Take photo with camera"
            className="flex-1 min-h-touch border-2 border-dashed border-espresso/20 rounded-card
                       flex flex-col items-center justify-center gap-1 py-3 px-2 text-center
                       hover:border-espresso/40 hover:bg-espresso/5 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-sage"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="font-body text-xs font-semibold text-espresso">Take photo</span>
          </button>

          <button
            type="button"
            onClick={() => albumInputRef.current?.click()}
            disabled={disabled}
            aria-label={`Choose from album (up to ${remaining} more photo${remaining !== 1 ? "s" : ""})`}
            className="flex-1 min-h-touch border-2 border-dashed border-espresso/20 rounded-card
                       flex flex-col items-center justify-center gap-1 py-3 px-2 text-center
                       hover:border-espresso/40 hover:bg-espresso/5 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-sage"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span className="font-body text-xs font-semibold text-espresso">Choose from album</span>
          </button>
        </div>
      )}

      {files.length === 0 && !canAdd && null}

      {files.length > 0 && (
        <p className="text-xs text-sage text-center">
          {files.length} of {MAX_COUNT} photos selected
          {files.length < MAX_COUNT && " — you can add more"}
        </p>
      )}

      {files.length === 0 && (
        <p className="text-xs text-sage text-center">
          Add up to {MAX_COUNT} photos of the bean bag from different angles
        </p>
      )}

      {/* Hidden camera input — capture=environment opens camera */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        aria-label="Camera input"
        onChange={handleCameraInput}
        disabled={disabled}
        tabIndex={-1}
      />

      {/* Hidden album input — multiple selection, no capture */}
      <input
        ref={albumInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="Album input"
        onChange={handleAlbumInput}
        disabled={disabled}
        tabIndex={-1}
      />

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
