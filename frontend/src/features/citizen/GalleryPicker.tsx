import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Alert } from "../../components/ui";
import { LocationMap } from "../../components/reports/LocationMap";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from "./reportsApi";
import type { Coordinates } from "../../lib/reportTypes";

interface GalleryPickerProps {
  photo: File | null;
  location: Coordinates | null;
  onPhotoChange: (photo: File | null) => void;
  onLocationChange: (location: Coordinates) => void;
}

/** Choose an existing photo and pick the damage location on the map. */
export function GalleryPicker({ photo, location, onPhotoChange, onLocationChange }: GalleryPickerProps) {
  const inputId = useId();
  const [error, setError] = useState<string>();
  const [previewUrl, setPreviewUrl] = useState<string>();

  useEffect(() => {
    if (photo === null) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(undefined);
    if (file === null) {
      onPhotoChange(null);
      return;
    }
    // Quick feedback only; the server checks the real file content.
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setError("Choose a JPEG or PNG photo.");
      event.target.value = "";
      onPhotoChange(null);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("The photo is larger than 10 MB. Choose a smaller photo.");
      event.target.value = "";
      onPhotoChange(null);
      return;
    }
    onPhotoChange(file);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
          Photo of the damage
        </label>
        <input
          id={inputId}
          type="file"
          accept={ALLOWED_PHOTO_TYPES.join(",")}
          onChange={handleFile}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
        />
        <p className="text-xs text-slate-500">JPEG or PNG, up to 10 MB.</p>
        {error !== undefined && <Alert>{error}</Alert>}
        {previewUrl !== undefined && (
          <img src={previewUrl} alt="Selected road damage" className="max-h-80 w-full rounded-lg bg-slate-100 object-contain" />
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Where is the damage?</p>
        <LocationMap value={location} onChange={onLocationChange} />
        <p className="text-xs text-slate-500">
          If your photo contains location data, we compare it with the place you select. Reports are never rejected because of this;
          differences are checked by an administrator.
        </p>
      </div>
    </div>
  );
}
