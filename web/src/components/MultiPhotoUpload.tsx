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
    <div className="photo-placeholder">
      {previewUrl && (
        <img
          src={previewUrl}
          alt={`${index + 1}: ${file.name}`}
          className="h-full w-full object-cover"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove photo ${index + 1}`}
      >
        ×
      </button>
      <small>{file.name}</small>
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
    <>
      {files.length > 0 && (
        <div
          className="photo-preview-row"
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
        <div className="upload-actions">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            aria-label="Take photo with camera"
          >
            <span className="upload-icon sage">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <title>Camera</title>
                <path d="M3 7h4l1.5-2h7L17 7h4v12H3z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </span>
            <strong>Take photo</strong>
            <small>Bag front or roast label</small>
          </button>

          <button
            type="button"
            onClick={() => albumInputRef.current?.click()}
            disabled={disabled}
            aria-label={`Choose from album (up to ${remaining} more photo${remaining !== 1 ? "s" : ""})`}
          >
            <span className="upload-icon clay">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <title>Photo library</title>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m4 17 5-5 4 4 2-2 5 5" />
              </svg>
            </span>
            <strong>Choose from album</strong>
            <small>Up to {remaining} more</small>
          </button>
        </div>
      )}

      <p className="upload-hint">
        {files.length < MAX_COUNT
          ? `Add up to ${MAX_COUNT} photos of the bean bag from different angles`
          : `${MAX_COUNT} of ${MAX_COUNT} photos selected`}
      </p>

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
        <p role="alert" className="upload-error">
          {error}
        </p>
      )}
    </>
  );
}
