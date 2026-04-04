import React, { useState } from 'react';

const AVATARS = [
  { id: 'shiba', label: 'Shiba' },
  { id: 'husky', label: 'Husky' },
  { id: 'fox', label: 'Fox' },
];

export interface ProfileCreationProps {
  onProfileSaved: (nickname: string, avatarSeed: string) => void;
}

export const ProfileCreation: React.FC<ProfileCreationProps> = ({ onProfileSaved }) => {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    if (!nickname.trim()) return;
    setIsSaving(true);
    setTimeout(() => {
      onProfileSaved(nickname, selectedAvatar.id);
    }, 1200);
  };

  const progress = isSaving ? 100 : nickname.trim() ? 66 : 33;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Progress bar */}
      <div className="w-full px-10 pt-8">
        <div className="w-full max-w-[480px] mx-auto h-2 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex items-center justify-center px-10">
        <div className="flex flex-col items-center w-full max-w-[440px]">

          <div className="w-full mb-6">
            <h2 className="text-lg font-bold text-foreground mb-3">Choose a nickname</h2>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="feyyazcigim"
              maxLength={20}
              className="w-full h-12 bg-card border border-border rounded-xl px-4 text-foreground text-base outline-none transition-all focus:ring-2 focus:ring-accent/40 focus:border-accent placeholder:text-muted-foreground"
            />
          </div>

          <div className="w-full mb-6">
            <h2 className="text-lg font-bold text-foreground mb-3">Choose your avatar</h2>
            <div className="grid grid-cols-3 gap-3">
              {AVATARS.map(avatar => (
                <button
                  key={avatar.id}
                  onClick={() => setSelectedAvatar(avatar)}
                  className={`h-12 rounded-xl border-2 bg-card flex items-center justify-center cursor-pointer transition-all duration-150 hover:-translate-y-0.5 ${
                    selectedAvatar.id === avatar.id
                      ? 'border-accent shadow-[0_0_12px_hsl(var(--accent)/0.3)] text-accent font-semibold'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >
                  <span className="text-base">{avatar.label}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!nickname.trim() || isSaving}
            className="mt-2 w-full h-[54px] rounded-full bg-accent text-accent-foreground text-base font-bold cursor-pointer flex items-center justify-center transition-all duration-150 hover:bg-accent/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
};
