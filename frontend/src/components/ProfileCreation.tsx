import React, { useState } from 'react';
import confetti from 'canvas-confetti';

const avatarSeeds = ['Felix', 'Aneka', 'Abby', 'Buster', 'Lucy', 'Leo', 'Max', 'Molly'];

export interface ProfileCreationProps {
  onProfileSaved: (nickname: string, avatarSeed: string) => void;
}

export const ProfileCreation: React.FC<ProfileCreationProps> = ({ onProfileSaved }) => {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(avatarSeeds[0]);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    
    // Trigger confetti burst
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#ffc107', '#ff9800', '#ffeb3b']
    });

    // Wait for animation then save
    setTimeout(() => {
      onProfileSaved(nickname, selectedAvatar);
    }, 2500);
  };

  return (
    <div className="relative w-screen h-screen flex flex-col items-center overflow-hidden">
      {/* Background removed */}

      {/* Progress Bar (Mock) */}
      <div className="w-[400px] h-[10px] bg-[#2a2a4a] rounded-full mt-12 z-10 relative overflow-hidden">
        <div 
          className="h-full bg-[#ffcc00] rounded-full transition-all duration-1000 ease-in-out"
          style={{ width: isSaving ? '100%' : '40%' }}
        ></div>
      </div>

      <div className="flex flex-row items-center justify-center gap-10 lg:gap-24 px-8 md:px-12 w-full max-w-6xl h-[calc(100%-150px)] z-10 relative">
        {/* Left Side: Avatar on Planet */}
        <div className="relative w-full max-w-[500px] flex-1 flex flex-col items-center justify-center">
          <div className="text-3xl lg:text-4xl font-bold text-white text-glow z-[3] mb-8">
            {nickname || 'Player'}
          </div>
          <div className="z-[2] animate-float-avatar -mb-16">
            <img 
              src={`https://api.dicebear.com/8.x/adventurer/svg?seed=${selectedAvatar}`} 
              alt="Current Avatar" 
              className="w-[200px] h-[200px] lg:w-[250px] lg:h-[250px] filter drop-shadow-[0_20px_20px_rgba(0,0,0,0.8)]"
            />
          </div>
          {/* Glassmorphic 3D Energy Sphere */}
          <div 
            className="w-[300px] h-[300px] lg:w-[450px] lg:h-[450px] rounded-full z-[1] border-t border-[#a07aff]/40 shadow-2xl"
            style={{
              background: 'radial-gradient(circle at 35% 20%, rgba(200, 180, 255, 0.9) 0%, rgba(120, 80, 240, 0.85) 20%, rgba(30, 10, 120, 0.95) 55%, rgba(5, 0, 30, 1) 90%)',
              boxShadow: 'inset -50px -50px 100px rgba(0,0,0,0.9), inset 20px 20px 80px rgba(255,255,255,0.4), 0 -20px 100px rgba(131,103,240,0.4), 0 0 150px rgba(66,0,255,0.3)',
            }}
          ></div>
        </div>

        {/* Right Side: Form or Success */}
        <div className="flex flex-col items-center justify-center w-full max-w-[450px] flex-1">
          {isSaving ? (
            <div className="flex flex-col items-center animate-pulse text-center">
              <h2 
                className="text-5xl lg:text-7xl font-extrabold text-[#ffcc00] mb-12 transform lg:scale-110" 
                style={{ textShadow: '0 6px 0 #cc9900, 0 10px 20px rgba(255, 204, 0, 0.4)' }}
              >
                Great!
              </h2>
              <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-8"></div>
              <p className="text-[#a0a0c0] text-lg lg:text-xl italic">You're all set - let's explore the world!</p>
            </div>
          ) : (
            <>
              <div className="w-full mb-8 flex flex-col items-center">
                <label className="text-xl font-bold mb-3 text-[#f8f8ff] italic drop-shadow-md">
                  Choose nickname
                </label>
                <input 
                  type="text" 
                  value={nickname} 
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. merenkirkas"
                  maxLength={20}
                  className="w-full bg-[#1e1e3c]/70 border border-white/15 p-4 rounded-xl text-white text-lg text-left font-inherit outline-none transition-all duration-300 input-glow focus:border-brandPrimary focus:bg-[#282850]/90 placeholder-[#8888aa]"
                />
              </div>

              <div className="w-full mb-8 flex flex-col items-center">
                <label className="text-xl font-bold mb-3 text-[#f8f8ff] italic drop-shadow-md">
                  Choose avatar
                </label>
                <div className="grid grid-cols-4 gap-4 w-full">
                  {avatarSeeds.map(seed => (
                    <div 
                      key={seed} 
                      className={`bg-[#1e1e3c]/70 border-2 rounded-xl p-3 cursor-pointer flex justify-center items-center transition-all duration-200 hover:bg-[#32325a]/80 hover:-translate-y-1 ${
                        selectedAvatar === seed 
                          ? 'border-brandPrimary bg-brandPrimary/20 avatar-selected-glow' 
                          : 'border-transparent'
                      }`}
                      onClick={() => setSelectedAvatar(seed)}
                    >
                      <img 
                        src={`https://api.dicebear.com/8.x/adventurer/svg?seed=${seed}`} 
                        alt={`Avatar ${seed}`} 
                        className="w-[70px] h-[70px]"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-sm text-[#8888aa] mb-10">
                (Don't worry, you can change this later)
              </div>

              <button 
                className="bg-btn-gradient text-white border-none py-4 px-12 rounded-full text-xl font-bold uppercase tracking-wider cursor-pointer btn-shadow transition-transform duration-100 outline-none"
                onClick={handleSave}
              >
                SAVE PROFILE
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
