'use client';

export default function NavUserProfile() {
  return (
    <div className="flex flex-col items-center gap-2 border-l border-border pl-6">
      {/* Welcome Message */}
      <p className="text-sm font-semibold text-foreground">Welcome Jon</p>

      {/* User Avatar */}
      <div className="w-10 h-10 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-semibold text-sm">
        J
      </div>
    </div>
  );
}
