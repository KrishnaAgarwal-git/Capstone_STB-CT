import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { profileApi, authApi } from "../api";
import { useAuth } from "../context/AuthContext";
import { REGIONS } from '../utils/regions';
import AppShell from "./AppShell";
import { spotlightMove } from "../utils/spotlight";

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [region, setRegion] = useState(user?.region || "IN-PB");
  const [ownsEV, setOwnsEV] = useState(false);
  const [saving, setSaving] = useState(false);

  const initial = (user?.firstName || "?").charAt(0).toUpperCase();

  const pickFile = () => fileRef.current?.click();

  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Avatar must be under 5MB.");

    setUploading(true);
    try {
      await profileApi.uploadAvatar(file);
      toast.success("Avatar updated");
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      await profileApi.deleteAvatar();
      toast.success("Avatar removed");
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await authApi.updateProfile({ region, ownsEV });
      toast.success("Settings saved");
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="page-eyebrow">Account</p>
          <h1 className="page-title">Your Profile</h1>
          <p className="page-sub">Manage your avatar and region settings.</p>
        </div>
      </div>

      <div className="panel spotlight" style={{ maxWidth: 520 }} onMouseMove={spotlightMove}>
        <p className="panel-title">Avatar</p>
        <div className="avatar-row">
          <div className="avatar-circle">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" />
            ) : (
              initial
            )}
          </div>
          <div className="avatar-actions">
            <input
              ref={fileRef}
              type="file"
              className="avatar-file-input"
              accept="image/jpeg,image/png,image/webp"
              onChange={onFileChange}
            />
            <button className="btn btn--primary btn--sm" onClick={pickFile} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload new photo"}
            </button>
            {user?.avatarUrl && (
              <button className="btn btn--ghost btn--sm" onClick={removeAvatar} disabled={uploading}>
                Remove photo
              </button>
            )}
            <p className="field-hint">JPEG, PNG, or WEBP. Max 5MB.</p>
          </div>
        </div>
      </div>

      <div className="panel spotlight" style={{ maxWidth: 520, marginTop: 20 }} onMouseMove={spotlightMove}>
        <p className="panel-title">Carbon Context</p>
        <form onSubmit={saveSettings}>
          <label className="field-label">Region</label>
          <p className="field-hint">Used to apply the correct electricity grid mix to your carbon estimates.</p>
          <select className="field" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>

          <label className="checkbox-label">
            <input type="checkbox" checked={ownsEV} onChange={(e) => setOwnsEV(e.target.checked)} />
            I own an electric vehicle
          </label>

          <button className="btn btn--primary" style={{ marginTop: 20 }} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
