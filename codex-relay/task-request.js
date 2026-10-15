// Bound multipart parsing itself, including requests without Content-Length.
const MAX_REQUEST_BYTES = 26 * 1024 * 1024;

export async function readTaskForm(request) {
  const tooLarge = () => Object.assign(new Error('The request is too large. Attachments must total 25 MB or less.'), { status: 413 });
  const contentLength = Number(request.headers.get('Content-Length'));
  if (contentLength > MAX_REQUEST_BYTES) throw tooLarge();
  let bytes = 0;
  const body = request.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > MAX_REQUEST_BYTES) throw tooLarge();
      controller.enqueue(chunk);
    }
  }));
  try {
    return await new Request(request, { body, duplex: 'half' }).formData();
  } catch (error) {
    if (bytes > MAX_REQUEST_BYTES || error.status === 413) throw tooLarge();
    throw Object.assign(new Error('Request body must be multipart form data.'), { status: 400 });
  }
}
