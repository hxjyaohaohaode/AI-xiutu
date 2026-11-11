#include <libheif/heif.h>
#include <libheif/heif_sequences.h>
#include <stdio.h>
#include <string.h>

static int checked(heif_error result) {
    if (result.code == heif_error_Ok) return 1;
    fprintf(stderr, "HEIC decoder rejected the image (%d/%d)\n", result.code, result.subcode);
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
        if (!heif_have_decoder_for_format(heif_compression_HEVC)) return 1;
        puts(heif_get_version());
        return 0;
    }
    const int decode = argc == 4 && strcmp(argv[1], "--decode") == 0;
    if (!decode && !(argc == 3 && strcmp(argv[1], "--inspect") == 0)) return 1;
    heif_context *context = heif_context_alloc();
    heif_image_handle *handle = NULL;
    heif_color_profile_nclx *profile = NULL;
    heif_decoding_options *options = NULL;
    heif_image *image = NULL;
    FILE *output = NULL;
    int exit_code = 1;
    if (!context) return 1;
    heif_context_set_max_decoding_threads(context, 2);
    if (!checked(heif_context_read_from_file(context, argv[2], NULL)) ||
        !checked(heif_context_get_primary_image_handle(context, &handle))) goto done;
    const int width = heif_image_handle_get_width(handle);
    const int height = heif_image_handle_get_height(handle);
    const int bits = heif_image_handle_get_luma_bits_per_pixel(handle);
    if (heif_context_has_sequence(context) ||
        heif_context_get_number_of_top_level_images(context) != 1 ||
        heif_image_handle_has_alpha_channel(handle) ||
        heif_image_handle_get_number_of_auxiliary_images(handle, 0) ||
        width < 8 || height < 8 || width > 8192 || height > 8192 ||
        (long long)width * height > 24000000 || (bits != 10 && bits != 12)) {
        fprintf(stderr, "HEIC requires a bounded single opaque PQ raster\n");
        goto done;
    }
    if (!checked(heif_image_handle_get_nclx_color_profile(handle, &profile))) goto done;
    const unsigned int primaries = profile->color_primaries;
    if (profile->transfer_characteristics != heif_transfer_characteristic_ITU_R_BT_2100_0_PQ ||
        (primaries != 1 && primaries != 9 && primaries != 12) ||
        heif_image_handle_get_raw_color_profile_size(handle) != 0) {
        fprintf(stderr, "HEIC requires an explicit supported NCLX PQ colour profile\n");
        goto done;
    }
    if (decode) {
        options = heif_decoding_options_alloc();
        if (!options) goto done;
        options->strict_decoding = 1;
        options->output_image_nclx_profile_passthrough = 1;
        if (!checked(heif_decode_image(handle, &image, heif_colorspace_RGB,
                                       heif_chroma_interleaved_RRGGBB_LE, options))) goto done;
        const heif_channel channel = heif_channel_interleaved;
        size_t stride = 0;
        const uint8_t *plane = heif_image_get_plane_readonly2(image, channel, &stride);
        const size_t row_bytes = (size_t)width * 6;
        if (!plane || stride < row_bytes ||
            heif_image_get_width(image, channel) != width ||
            heif_image_get_height(image, channel) != height ||
            heif_image_get_bits_per_pixel_range(image, channel) != bits) {
            fprintf(stderr, "Decoded HEIC raster differs from the inspected geometry or precision\n");
            goto done;
        }
        output = fopen(argv[3], "wbx");
        if (!output) goto done;
        for (int row = 0; row < height; row++)
            if (fwrite(plane + (size_t)row * stride, 1, row_bytes, output) != row_bytes) goto done;
        if (fclose(output)) {
            output = NULL;
            goto done;
        }
        output = NULL;
    }
    const uint32_t diffuse_white = heif_image_handle_get_nominal_diffuse_white_luminance(handle);
    printf("{\"width\":%d,\"height\":%d,\"bitDepth\":%d,\"primaries\":%u,"
           "\"diffuseWhite\":%u,\"codec\":\"%s\"}\n",
           width, height, bits, primaries, diffuse_white, heif_get_version());
    exit_code = 0;
done:
    if (output) fclose(output);
    if (image) heif_image_release(image);
    if (options) heif_decoding_options_free(options);
    if (profile) heif_nclx_color_profile_free(profile);
    if (handle) heif_image_handle_release(handle);
    heif_context_free(context);
    return exit_code;
}
