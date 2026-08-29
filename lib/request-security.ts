export function validateJsonMutation(request: Request): Response | null {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return Response.json({ error: 'unsupported_media_type' }, { status: 415 });
  }

  return validateSameOriginMutation(request);
}

export function validateMultipartMutation(request: Request): Response | null {
  const contentType = request.headers.get('content-type')?.trim().toLowerCase();
  if (!contentType?.startsWith('multipart/form-data;') || !contentType.includes('boundary=')) {
    return Response.json({ error: 'unsupported_media_type' }, { status: 415 });
  }

  return validateSameOriginMutation(request);
}

export function validateSameOriginMutation(request: Request): Response | null {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  const originMatches = origin === expectedOrigin;
  const browserConfirmsSameOrigin = fetchSite === 'same-origin';
  if (!originMatches && !browserConfirmsSameOrigin) {
    return Response.json({ error: 'cross_origin_request_rejected' }, { status: 403 });
  }
  return null;
}
