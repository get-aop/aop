import type { RuntimeProfile } from "@aop/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

interface RuntimeProfilePickerProps {
  profiles: RuntimeProfile[];
  onApply: (profile: RuntimeProfile) => void;
}

export const RuntimeProfilePicker = ({ profiles, onApply }: RuntimeProfilePickerProps) => {
  const availableProfiles = profiles;

  if (availableProfiles.length === 0) return null;

  return (
    <div className="grid gap-1.5 text-xs font-medium text-text-muted">
      <span>Apply profile</span>
      <Select
        onValueChange={(profileId) => {
          const profile = availableProfiles.find((item) => item.id === profileId);
          if (profile) onApply(profile);
        }}
      >
        <SelectTrigger aria-label="Apply profile" className="w-full">
          <SelectValue placeholder="Choose a saved profile…" />
        </SelectTrigger>
        <SelectContent>
          {availableProfiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
