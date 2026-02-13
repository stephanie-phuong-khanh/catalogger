import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

/**
 * Client upload route for the pricing sheet.
 * The browser uploads the file directly to Vercel Blob (bypassing 4.5MB body limit).
 * We only issue a token here; no file passes through this server.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
        ],
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Optional: run logic after upload (e.g. cleanup). Parse happens in parse-sheet.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }
}
