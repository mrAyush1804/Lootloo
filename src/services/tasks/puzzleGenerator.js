const sharp = require('sharp');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const logger = require('../../utils/logger');
const {
  ValidationError,
  NotFoundError
} = require('../../middleware/errorHandler');

class PuzzleGenerator {
  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'ap-south-1'
    });
    this.bucket = process.env.S3_BUCKET;
    this.cdnUrl = process.env.CDN_URL || 'https://cdn.taskloot.com';
  }

  /**
   * Generate image puzzle configuration
   * @param {Buffer} imageBuffer - Image file buffer
   * @param {number} gridSize - 9 (3x3), 16 (4x4), 25 (5x5)
   * @returns {Object} puzzle config with piece hashes
   */
  async generateImagePuzzle(imageBuffer, gridSize = 9) {
    try {
      // Validate grid size
      if (![9, 16, 25].includes(gridSize)) {
        throw new ValidationError('Grid size must be 9, 16, or 25');
      }

      // Validate image
      if (!this.isValidImage(imageBuffer)) {
        throw new ValidationError('Invalid image format. Must be JPEG/PNG and < 5MB');
      }

      logger.info('Generating puzzle', { gridSize, imageSize: imageBuffer.length });

      // Resize to standard size (400x400)
      const resized = await sharp(imageBuffer)
        .resize(400, 400, { 
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      // Generate unique key for the image
      const imageKey = `puzzles/${uuidv4()}-original.jpg`;
      
      // Upload original image to S3
      await this.uploadToS3(imageKey, resized, 'image/jpeg');

      // Generate puzzle pieces
      const piecesPerSide = Math.sqrt(gridSize);
      const pieceSize = 400 / piecesPerSide;

      let pieces = [];
      let pieceBuffers = [];

      // Extract pieces
      for (let row = 0; row < piecesPerSide; row++) {
        for (let col = 0; col < piecesPerSide; col++) {
          const piece = await sharp(resized)
            .extract({
              left: Math.floor(col * pieceSize),
              top: Math.floor(row * pieceSize),
              width: Math.floor(pieceSize),
              height: Math.floor(pieceSize)
            })
            .jpeg({ quality: 90 })
            .toBuffer();

          const pieceHash = crypto
            .createHash('sha256')
            .update(piece)
            .digest('hex');

          const pieceData = {
            index: row * piecesPerSide + col,
            hash: pieceHash,
            row,
            col
          };

          pieces.push(pieceData);
          pieceBuffers.push(piece);
        }
      }

      // Upload individual pieces to S3 (optional - for debugging)
      // In production, we might not need to store individual pieces
      const pieceKeys = [];
      for (let i = 0; i < pieceBuffers.length; i++) {
        const pieceKey = `puzzles/${uuidv4()}-piece-${i}.jpg`;
        // await this.uploadToS3(pieceKey, pieceBuffers[i], 'image/jpeg');
        pieceKeys.push(pieceKey);
      }

      // Shuffle pieces for frontend
      const shuffledIndices = this.shuffleArray([...Array(gridSize).keys()]);
      
      // Calculate difficulty based on image complexity
      const difficulty = this.calculateDifficulty(pieces, pieceBuffers);

      const puzzleConfig = {
        image_url: `${this.cdnUrl}/${imageKey}`,
        grid_size: piecesPerSide,
        piece_count: gridSize,
        pieces: pieces.map(p => ({ index: p.index, hash: p.hash })),
        shuffled_order: shuffledIndices,
        difficulty_seed: difficulty,
        correct_solution: pieces.map(p => p.index), // Original order
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      };

      logger.info('Puzzle generated successfully', {
        gridSize,
        piecesCount: pieces.length,
        difficulty,
        imageUrl: puzzleConfig.image_url
      });

      return puzzleConfig;

    } catch (error) {
      logger.error('Puzzle generation failed:', error);
      throw error;
    }
  }

  /**
   * Validate puzzle solution
   * @param {Array} userSolution - User's piece arrangement [0,1,2,3...]
   * @param {Array} correctSolution - Server's correct arrangement
   * @param {number} timeTaken - Time taken in milliseconds
   * @returns {Object} { is_correct, score, time_bonus }
   */
  validateSolution(userSolution, correctSolution, timeTaken) {
    try {
      // Validate input arrays
      if (!Array.isArray(userSolution) || !Array.isArray(correctSolution)) {
        throw new ValidationError('Invalid solution format');
      }

      if (userSolution.length !== correctSolution.length) {
        throw new ValidationError('Solution arrays must have same length');
      }

      // Check if arrays match exactly
      const isCorrect = JSON.stringify(userSolution) === JSON.stringify(correctSolution);

      if (!isCorrect) {
        return {
          is_correct: false,
          score: 0,
          time_bonus: 0,
          error: 'Puzzle arrangement is incorrect'
        };
      }

      // Calculate score based on time
      const maxTimeSeconds = 300; // 5 minutes
      const timeTakenSeconds = timeTaken / 1000;
      const timeRatio = Math.max(0, (maxTimeSeconds - timeTakenSeconds) / maxTimeSeconds);
      const baseScore = 100;
      const timeBonus = Math.floor(timeRatio * 50);

      const totalScore = baseScore + timeBonus;

      logger.debug('Puzzle solution validated', {
        isCorrect,
        timeTakenSeconds,
        timeRatio,
        baseScore,
        timeBonus,
        totalScore
      });

      return {
        is_correct: true,
        score: totalScore,
        base_score: baseScore,
        time_bonus: timeBonus,
        time_taken_seconds: timeTakenSeconds
      };

    } catch (error) {
      logger.error('Solution validation failed:', error);
      throw error;
    }
  }

  /**
   * Calculate difficulty based on image complexity
   * @param {Array} pieces - Puzzle pieces data
   * @param {Array} pieceBuffers - Piece image buffers
   * @returns {string} 'easy' | 'medium' | 'hard'
   */
  calculateDifficulty(pieces, pieceBuffers) {
    try {
      // Analyze image entropy, color variance, pattern repetition
      // This is a simplified implementation
      // In production, you'd use more sophisticated algorithms

      let totalEntropy = 0;
      let colorVariance = 0;

      // Calculate average color variance across pieces
      for (const buffer of pieceBuffers) {
        const { data } = sharp(buffer)
          .resize(50, 50) // Smaller size for faster processing
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Calculate color variance (simplified)
        const colors = new Set();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          colors.add(`${r},${g},${b}`);
        }

        const uniqueColors = colors.size;
        const totalPixels = data.length / 4;
        const entropy = uniqueColors / totalPixels;
        totalEntropy += entropy;
      }

      const avgEntropy = totalEntropy / pieceBuffers.length;

      // Determine difficulty based on entropy
      if (avgEntropy < 0.1) return 'easy';
      if (avgEntropy < 0.3) return 'medium';
      return 'hard';

    } catch (error) {
      logger.error('Difficulty calculation failed:', error);
      return 'medium'; // Default to medium
    }
  }

  /**
   * Validate image format and size
   * @param {Buffer} buffer - Image buffer
   * @returns {boolean}
   */
  isValidImage(buffer) {
    try {
      // Check size
      if (!buffer || buffer.length === 0 || buffer.length > 5_000_000) {
        return false;
      }

      // Check image format by reading metadata
      const metadata = sharp(buffer).metadata();
      
      // Supported formats
      const supportedFormats = ['jpeg', 'png', 'webp'];
      
      return supportedFormats.includes(metadata.format) && 
             metadata.width > 0 && 
             metadata.height > 0;

    } catch (error) {
      return false;
    }
  }

  /**
   * Upload file to S3
   * @param {string} key - S3 key
   * @param {Buffer} body - File buffer
   * @param {string} contentType - MIME type
   */
  async uploadToS3(key, body, contentType) {
    try {
      const params = {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'max-age=31536000', // 1 year cache
        Metadata: {
          uploadedAt: new Date().toISOString(),
          service: 'taskloot-puzzle-generator'
        }
      };

      const result = await this.s3.upload(params).promise();
      
      logger.debug('File uploaded to S3', {
        key,
        url: result.Location,
        size: body.length,
        contentType
      });

      return result;

    } catch (error) {
      logger.error('S3 upload failed:', error);
      throw new Error('Failed to upload image to storage');
    }
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Generate puzzle preview (thumbnail)
   * @param {Buffer} imageBuffer - Original image buffer
   * @returns {string} Preview image URL
   */
  async generatePreview(imageBuffer) {
    try {
      const preview = await sharp(imageBuffer)
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toBuffer();

      const previewKey = `puzzles/previews/${uuidv4()}.jpg`;
      await this.uploadToS3(previewKey, preview, 'image/jpeg');

      return `${this.cdnUrl}/${previewKey}`;

    } catch (error) {
      logger.error('Preview generation failed:', error);
      throw new Error('Failed to generate preview');
    }
  }

  /**
   * Delete puzzle assets from S3
   * @param {string} imageUrl - Main image URL
   * @param {Array} pieceUrls - Array of piece URLs (optional)
   */
  async deletePuzzleAssets(imageUrl, pieceUrls = []) {
    try {
      const keysToDelete = [];

      // Extract key from URL
      if (imageUrl) {
        const key = imageUrl.replace(`${this.cdnUrl}/`, '');
        keysToDelete.push(key);
      }

      // Extract piece keys
      pieceUrls.forEach(url => {
        const key = url.replace(`${this.cdnUrl}/`, '');
        keysToDelete.push(key);
      });

      if (keysToDelete.length > 0) {
        const params = {
          Bucket: this.bucket,
          Delete: {
            Objects: keysToDelete.map(key => ({ Key: key }))
          }
        };

        await this.s3.deleteObjects(params).promise();
        
        logger.info('Puzzle assets deleted', { keys: keysToDelete });
      }

    } catch (error) {
      logger.error('Failed to delete puzzle assets:', error);
      // Don't throw error - cleanup is not critical
    }
  }
}

module.exports = new PuzzleGenerator();
