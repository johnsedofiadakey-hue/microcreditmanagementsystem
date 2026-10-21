'use client';

import type { ListEnquiriesRequest, ListEnquiriesResult, UpdateEnquiryRequest, EnquirySummary } from '@susu/shared';
import { call, write } from './api';

export function listEnquiries(input: ListEnquiriesRequest = {}) {
  return call<ListEnquiriesRequest, ListEnquiriesResult>('listEnquiries', { ...input, limit: input.limit ?? 50 });
}

export function updateEnquiry(input: UpdateEnquiryRequest) {
  return write<UpdateEnquiryRequest, EnquirySummary>('updateEnquiry', input);
}
