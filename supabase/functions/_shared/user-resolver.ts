/**
 * Shared helper for resolving user IDs
 * Handles the confusion between profiles.id and profiles.user_id
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ResolvedUserIds {
  authUserId: string | null;
  profileId: string | null;
  wasNormalized: boolean;
  resolvedFrom: 'direct_user_id' | 'from_profile_id' | 'not_found';
}

/**
 * Resolves an input ID to both auth_user_id and profile_id
 * Handles cases where profile.id was passed instead of profile.user_id
 * 
 * @param supabase - Supabase client instance
 * @param inputId - UUID that could be either profiles.user_id or profiles.id
 * @returns Object with authUserId, profileId, and normalization info
 */
export async function resolveUserIds(
  supabase: SupabaseClient,
  inputId: string
): Promise<ResolvedUserIds> {
  if (!inputId) {
    return { 
      authUserId: null, 
      profileId: null, 
      wasNormalized: false, 
      resolvedFrom: 'not_found' 
    };
  }

  // First, check if this is a profiles.user_id (the correct case)
  const { data: byUserId, error: error1 } = await supabase
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', inputId)
    .maybeSingle();

  if (byUserId) {
    return {
      authUserId: byUserId.user_id,
      profileId: byUserId.id,
      wasNormalized: false,
      resolvedFrom: 'direct_user_id'
    };
  }

  // Fallback: check if this is a profiles.id (needs normalization)
  const { data: byId, error: error2 } = await supabase
    .from('profiles')
    .select('id, user_id')
    .eq('id', inputId)
    .maybeSingle();

  if (byId) {
    return {
      authUserId: byId.user_id, // May be null for ghost profiles
      profileId: byId.id,
      wasNormalized: true,
      resolvedFrom: 'from_profile_id'
    };
  }

  // Not found in either column
  return {
    authUserId: null,
    profileId: null,
    wasNormalized: false,
    resolvedFrom: 'not_found'
  };
}

/**
 * Gets the correct user_id for order creation
 * Returns the auth user_id if available, otherwise the profile_id for ghost profiles
 * 
 * @param supabase - Supabase client instance
 * @param inputId - UUID that could be either profiles.user_id or profiles.id
 * @returns The correct user_id to use for orders, plus metadata
 */
export async function getOrderUserId(
  supabase: SupabaseClient,
  inputId: string
): Promise<{
  userId: string;
  profileId: string | null;
  isGhostProfile: boolean;
  wasNormalized: boolean;
}> {
  const resolved = await resolveUserIds(supabase, inputId);

  if (resolved.resolvedFrom === 'not_found') {
    // Return original ID if nothing found (will be validated elsewhere)
    return {
      userId: inputId,
      profileId: null,
      isGhostProfile: false,
      wasNormalized: false
    };
  }

  // If we have auth user_id, use it; otherwise use profile_id (ghost profile)
  const isGhost = resolved.authUserId === null;
  
  return {
    userId: resolved.authUserId || resolved.profileId!,
    profileId: resolved.profileId,
    isGhostProfile: isGhost,
    wasNormalized: resolved.wasNormalized
  };
}

/**
 * Finds a profile by various identifiers
 * Used when we need the full profile and not just IDs
 */
export async function findProfileByAnyId(
  supabase: SupabaseClient,
  inputId: string
): Promise<{ profile: any | null; resolvedFrom: string }> {
  // Try by user_id first
  const { data: byUserId } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', inputId)
    .maybeSingle();

  if (byUserId) {
    return { profile: byUserId, resolvedFrom: 'user_id' };
  }

  // Try by profile id
  const { data: byId } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', inputId)
    .maybeSingle();

  if (byId) {
    return { profile: byId, resolvedFrom: 'profile_id' };
  }

  return { profile: null, resolvedFrom: 'not_found' };
}
