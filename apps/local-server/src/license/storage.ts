import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";

export const DEFAULT_LICENSE_SERVER_URL = "https://license.getaop.com";

export const createLicenseStorage = (settingsRepository: SettingsRepository) => ({
  getLicenseKey: () => settingsRepository.get(SettingKey.LICENSE_KEY),
  setLicenseKey: (value: string) => settingsRepository.set(SettingKey.LICENSE_KEY, value),
  getEntitlementJson: () => settingsRepository.get(SettingKey.LICENSE_ENTITLEMENT),
  setEntitlementJson: (value: string) =>
    settingsRepository.set(SettingKey.LICENSE_ENTITLEMENT, value),
  getMachineId: () => settingsRepository.get(SettingKey.LICENSE_MACHINE_ID),
  setMachineId: (value: string) => settingsRepository.set(SettingKey.LICENSE_MACHINE_ID, value),
  getServerUrl: () => settingsRepository.get(SettingKey.LICENSE_SERVER_URL),
  setServerUrl: (value: string) => settingsRepository.set(SettingKey.LICENSE_SERVER_URL, value),
  getValidatedAt: () => settingsRepository.get(SettingKey.LICENSE_VALIDATED_AT),
  setValidatedAt: (value: string) => settingsRepository.set(SettingKey.LICENSE_VALIDATED_AT, value),
  getLemonInstanceId: () => settingsRepository.get(SettingKey.LICENSE_LEMON_INSTANCE_ID),
  setLemonInstanceId: (value: string) =>
    settingsRepository.set(SettingKey.LICENSE_LEMON_INSTANCE_ID, value),
  clearLicense: async () => {
    await settingsRepository.set(SettingKey.LICENSE_KEY, "");
    await settingsRepository.set(SettingKey.LICENSE_ENTITLEMENT, "");
    await settingsRepository.set(SettingKey.LICENSE_VALIDATED_AT, "");
    await settingsRepository.set(SettingKey.LICENSE_LEMON_INSTANCE_ID, "");
  },
});

export type LicenseStorage = ReturnType<typeof createLicenseStorage>;
