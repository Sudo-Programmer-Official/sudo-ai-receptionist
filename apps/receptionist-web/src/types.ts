export type HealthResponse = {
  ok?: boolean;
  status?: string;
  service?: string;
  message?: string;
};

export type ToolStatus = {
  name: string;
  status: 'pending' | 'ok' | 'error';
  latencyMs?: number;
};

export type VoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'checking_availability'
  | 'offering_slots'
  | 'collecting_customer'
  | 'confirming'
  | 'booking'
  | 'booked'
  | 'error';

export type RealtimeConnectionState =
  | 'idle'
  | 'api_connected'
  | 'session_created'
  | 'webrtc_connecting'
  | 'webrtc_connected'
  | 'data_channel_open'
  | 'error';

export type MicState =
  | 'off'
  | 'requesting'
  | 'enabled'
  | 'blocked'
  | 'attached';

export type LatencyMetric = {
  name: string;
  valueMs: number;
  detail?: string;
};

export type RealtimeDiagnostics = {
  peerConnectionState: string;
  iceConnectionState: string;
  signalingState: string;
  dataChannelState: string;
  localAudioTrackState: string;
  remoteAudioReceived: boolean;
  lastEventType: string;
  lastErrorMessage: string;
};

export type BookingSlot = {
  slotId: string;
  startsAt: string;
  endsAt: string;
  staffId?: string;
  staffName?: string;
};

export type ConversationStateSnapshot = {
  conversationId?: string;
  businessId?: string;
  requestedService?: string;
  serviceId?: string;
  preferredDate?: string;
  preferredTimeRange?: string;
  staffPreference?: string;
  customerName?: string;
  customerPhone?: string;
  selectedSlot?: BookingSlot;
  proposedSlots?: BookingSlot[];
  bookingConfirmationStatus?: 'unconfirmed' | 'pending' | 'confirmed' | 'failed' | string;
  bookingId?: string;
  businessProfile?: {
    businessId: string;
    name: string;
    timezone: string;
    phone?: string;
    website?: string;
    policies?: string[];
  };
  services?: Array<{
    serviceId: string;
    name: string;
    durationMinutes: number;
  }>;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
};

export type ChatRequest = {
  text: string;
  state?: ConversationStateSnapshot;
  interrupted?: boolean;
};

export type ChatResponse = {
  message: string;
  state?: ConversationStateSnapshot;
  toolStatus?: ToolStatus[];
  requiresUserAction: boolean;
};

export type BusinessContext = {
  businessName: string;
  serviceNames: string[];
  timeZone?: string;
  location?: string;
  bookingPolicy?: string;
};

export type RealtimeSessionResponse = {
  businessId: string;
  conversationId: string;
  sessionToken: string;
  ephemeralSessionToken: string;
  webrtcUrl: string;
  expiresAt: string;
  model?: string;
  instructions?: string;
  businessContext?: BusinessContext;
};

export type RealtimeCallResponse = {
  answerSdp: string;
  callId: string;
  businessId: string;
  conversationId: string;
  model: string;
  expiresAt: string;
};

export type FrontendEnv = {
  VITE_RECEPTIONIST_API_URL?: string;
};
