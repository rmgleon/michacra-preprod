import type { Producer, UserProfile } from '../db/schema';

export function producerVerificationStatus(producer: Pick<Producer, 'verificationStatus' | 'verifiedBySupervisor'>): 'verified' | 'unverified' {
  return producer.verificationStatus ?? (producer.verifiedBySupervisor ? 'verified' : 'unverified');
}

export function canVerifyProducers(user?: UserProfile | null): boolean {
  return Boolean(user?.active && user.approvalStatus === 'approved' &&
    ['SUPERADMIN', 'ADMINISTRADOR', 'TECNICO'].includes(user.role));
}

export function adminVerification(userId: string, userName: string, now: string) {
  return {
    verificationStatus: 'verified' as const,
    verifiedBySupervisor: true,
    registrationSource: 'admin' as const,
    verifiedAt: now,
    verifiedById: userId,
    verifiedByName: userName,
  };
}
