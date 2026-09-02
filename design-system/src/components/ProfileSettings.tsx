"use client";

import { useEffect, useState, type FormEvent } from "react";

export type ProfileFields = {
  firstName: string;
  lastName: string;
  /** Sign-in address. Shown, never edited — changing it would change which account this is. */
  email: string;
  contactEmail: string;
};

export type DirectoryEntry = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type ProfileSettingsProps = {
  profile: ProfileFields;
  /** Label for the signed-in person's position, e.g. "Senior Director". */
  roleLabel: string;
  onSave: (fields: { firstName: string; lastName: string; contactEmail: string }) => void;
  busy?: boolean;
  notice?: string;
  error?: string;
  /** Populated only for Finance and administrators; everyone else never sees the directory. */
  directory?: DirectoryEntry[];
  roleOptions?: { value: string; label: string }[];
  onAssignRole?: (userId: string, role: string) => void;
  /** The signed-in person's own id, so their row can explain why it cannot be changed here. */
  currentUserId?: string;
};

/**
 * Profile settings: your name, how you are contacted, and — for Finance and administrators — the directory
 * where positions are assigned.
 *
 * Position is deliberately read-only on your own profile no matter who you are. It is displayed, because
 * people need to know what authority they hold, but the control to change it lives in the directory below
 * and never operates on your own row: an administrator cannot grant themselves signing authority without
 * another administrator doing it.
 */
export function ProfileSettings({
  profile,
  roleLabel,
  onSave,
  busy = false,
  notice = "",
  error = "",
  directory,
  roleOptions = [],
  onAssignRole,
  currentUserId,
}: ProfileSettingsProps) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [contactEmail, setContactEmail] = useState(profile.contactEmail);

  // Re-sync when the saved profile arrives or changes underneath the form.
  useEffect(() => {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setContactEmail(profile.contactEmail);
  }, [profile.firstName, profile.lastName, profile.contactEmail]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSave({ firstName: firstName.trim(), lastName: lastName.trim(), contactEmail: contactEmail.trim() });
  };

  return (
    <section className="page profilePage">
      <div className="profileCard">
        <h2>Profile settings</h2>
        <p className="profileLead">Your name as it appears on requests, and where the Hub should reach you.</p>

        {notice && <p className="profileNotice" role="status">{notice}</p>}
        {error && <p className="profileError" role="alert">{error}</p>}

        <form onSubmit={submit}>
          <div className="profileRow">
            <label>
              <span>First name</span>
              <input value={firstName} onChange={event => setFirstName(event.target.value)} disabled={busy} required />
            </label>
            <label>
              <span>Last name</span>
              <input value={lastName} onChange={event => setLastName(event.target.value)} disabled={busy} required />
            </label>
          </div>
          <label>
            <span>Contact email</span>
            <input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} disabled={busy} />
          </label>
          <div className="profileFixed">
            <div>
              <small>SIGN-IN ADDRESS</small>
              <strong>{profile.email}</strong>
            </div>
            <div>
              <small>POSITION</small>
              <strong>{roleLabel}</strong>
              <span>Set by Finance. Ask an administrator if this is wrong.</span>
            </div>
          </div>
          <button type="submit" disabled={busy || !firstName.trim() || !lastName.trim()}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
      </div>

      {directory && (
        <div className="profileCard">
          <h2>Positions</h2>
          <p className="profileLead">
            Signing authority follows the position. Changing one takes effect on the next request that person
            reviews.
          </p>
          <table className="directoryTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Sign-in address</th>
                <th>Position</th>
              </tr>
            </thead>
            <tbody>
              {directory.map(entry => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td className="directoryEmail">{entry.email}</td>
                  <td>
                    {entry.id === currentUserId ? (
                      <span className="directorySelf">{roleOptions.find(o => o.value === entry.role)?.label || entry.role} · your own</span>
                    ) : (
                      <select
                        value={entry.role}
                        disabled={busy}
                        onChange={event => onAssignRole?.(entry.id, event.target.value)}
                        aria-label={`Position for ${entry.name}`}
                      >
                        {roleOptions.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
