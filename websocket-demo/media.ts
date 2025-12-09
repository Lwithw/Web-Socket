// Media handling: upload, compression, storage
import crypto from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export interface MediaFile {
  id: string;
  type: 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'gif';
  mimeType: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  duration?: number; // For audio/video
  width?: number;
  height?: number;
}

export class MediaHandler {
  private uploadDir = './uploads';
  private maxFileSize = 100 * 1024 * 1024; // 100MB
  
  private allowedTypes = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    video: ['video/mp4', 'video/webm', 'video/quicktime'],
    document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    voice: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
    sticker: ['image/webp', 'image/png'],
    gif: ['image/gif']
  };

  constructor() {
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    if (!existsSync(this.uploadDir)) {
      await mkdir(this.uploadDir, { recursive: true });
    }
    
    // Create subdirectories
    const subdirs = ['images', 'videos', 'documents', 'voice', 'stickers', 'thumbnails'];
    for (const dir of subdirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!existsSync(fullPath)) {
        await mkdir(fullPath, { recursive: true });
      }
    }
  }

  // Validate file
  validateFile(file: Buffer, mimeType: string, type: MediaFile['type']): boolean {
    if (file.length > this.maxFileSize) {
      throw new Error(`File too large. Max size: ${this.maxFileSize / 1024 / 1024}MB`);
    }

    const allowedMimes = this.allowedTypes[type];
    if (!allowedMimes.includes(mimeType)) {
      throw new Error(`Invalid file type. Allowed: ${allowedMimes.join(', ')}`);
    }

    return true;
  }

  // Generate unique filename
  private generateFilename(originalName: string): string {
    const ext = path.extname(originalName);
    const hash = crypto.randomBytes(16).toString('hex');
    return `${Date.now()}-${hash}${ext}`;
  }

  // Save file to disk
  async saveFile(
    fileBuffer: Buffer,
    mimeType: string,
    type: MediaFile['type'],
    originalName: string
  ): Promise<MediaFile> {
    this.validateFile(fileBuffer, mimeType, type);

    const filename = this.generateFilename(originalName);
    const subdir = type === 'voice' ? 'voice' : 
                   type === 'sticker' ? 'stickers' :
                   type === 'gif' ? 'images' :
                   type === 'image' ? 'images' :
                   type === 'video' ? 'videos' : 'documents';
    
    const filepath = path.join(this.uploadDir, subdir, filename);
    await writeFile(filepath, fileBuffer);

    const mediaFile: MediaFile = {
      id: crypto.randomBytes(16).toString('hex'),
      type,
      mimeType,
      size: fileBuffer.length,
      url: `/uploads/${subdir}/${filename}`
    };

    // Generate thumbnail for images/videos
    if (type === 'image' || type === 'video') {
      mediaFile.thumbnailUrl = await this.generateThumbnail(filepath, type);
    }

    return mediaFile;
  }

  // Generate thumbnail (simplified - in production use sharp/ffmpeg)
  private async generateThumbnail(filepath: string, type: 'image' | 'video'): Promise<string> {
    // Placeholder - implement with sharp for images, ffmpeg for videos
    const filename = path.basename(filepath);
    const thumbnailPath = `/uploads/thumbnails/thumb_${filename}`;
    
    // TODO: Implement actual thumbnail generation
    // For images: use sharp library
    // For videos: use ffmpeg to extract frame
    
    return thumbnailPath;
  }

  // Compress image (simplified)
  async compressImage(buffer: Buffer, quality: number = 80): Promise<Buffer> {
    // Placeholder - implement with sharp
    // const sharp = require('sharp');
    // return await sharp(buffer)
    //   .jpeg({ quality })
    //   .toBuffer();
    
    return buffer; // Return original for now
  }

  // Compress video (simplified)
  async compressVideo(filepath: string): Promise<string> {
    // Placeholder - implement with ffmpeg
    // Use ffmpeg to compress video
    return filepath;
  }

  // Parse base64 data URL
  parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches || !matches[1] || !matches[2]) {
      throw new Error('Invalid data URL');
    }

    return {
      mimeType: matches[1],
      buffer: Buffer.from(matches[2], 'base64')
    };
  }

  // Handle file upload from WebSocket
  async handleUpload(data: {
    filename: string;
    mimeType: string;
    type: MediaFile['type'];
    data: string; // base64 or data URL
  }): Promise<MediaFile> {
    let fileBuffer: Buffer;
    let mimeType = data.mimeType;

    // Check if it's a data URL
    if (data.data.startsWith('data:')) {
      const parsed = this.parseDataUrl(data.data);
      fileBuffer = parsed.buffer;
      mimeType = parsed.mimeType;
    } else {
      fileBuffer = Buffer.from(data.data, 'base64');
    }

    // Compress if image
    if (data.type === 'image') {
      fileBuffer = await this.compressImage(fileBuffer);
    }

    return await this.saveFile(fileBuffer, mimeType, data.type, data.filename);
  }

  // Get file info
  getFileInfo(url: string): { exists: boolean; size?: number } {
    const filepath = path.join('.', url);
    if (!existsSync(filepath)) {
      return { exists: false };
    }

    const stats = require('fs').statSync(filepath);
    return {
      exists: true,
      size: stats.size
    };
  }
}

export const mediaHandler = new MediaHandler();
