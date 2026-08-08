#
#  Pocket SDR Python Library - LDPC Decoding Functions
#
#  References:
#  [1] IS-GPS-800E, NAVSTAR GPS Space Segment/Navigation User Segment
#      L1C Interfaces, March 4, 2019
#  [2] BeiDou Navigation Satellite System Signal In Space Interface Control
#      Document Open Service Signal B1C (Version 1.0), December, 2017
#  [3] BeiDou Navigation Satellite System Signal In Space Interface Control
#      Document Open Service Signal B2a (Version 1.0), December, 2017
#  [4] BeiDou Navigation Satellite System Signal In Space Interface Control
#      Document Open Service Signal B2b (Version 1.0), July, 2020
#  [5] NavIC Signal in Space ICD for Standard Positioning Service in L1
#      Frequency version 1.0, August, 2023
#
#  Author:
#  T.TAKASU
#
#  History:
#  2022-01-06  1.0  new
#  2023-01-07  1.1  support IRNV1_SF2 and IRNV1_SF3 in decode_LDPC()
#  2023-01-09  1.2  support BCNV1_SF2, BCNV1_SF3, BCNV2, BCNV3 in decode_LDPC()
#  2023-01-24  1.3  support NB-LDPC error correction
#  2026-08-07  1.4  use the decoder of the Pocket SDR library (sdr_ldpc.c),
#                   which replaced the LDPC-codes library dependency. The
#                   H-matrix tables moved to the library with it.
#
import os, platform
from ctypes import *
import numpy as np

# load Pocket SDR library ------------------------------------------------------
env = platform.platform()
dir = os.path.dirname(__file__)
if 'Windows' in env:
    lib = dir + '/../lib/win32/libsdr.so'
elif 'macOS' in env:
    lib = dir + '/../lib/macos/libsdr.so'
else: # linux or Raspberry Pi OS
    lib = dir + '/../lib/linux/libsdr.so'
try:
    libsdr = cdll.LoadLibrary(lib)
except:
    print('libsdr load error: ' + lib)
    exit(-1)

libsdr.sdr_decode_LDPC.argtypes = (c_char_p, POINTER(c_uint8), c_int32,
    POINTER(c_uint8))

# constants --------------------------------------------------------------------
NONE = np.array([], dtype='uint8')

# LDPC code lengths by type ([1] - [5]) ----------------------------------------
CODE_LEN = {
    'CNV2_SF2' : 1200, 'CNV2_SF3' :  548, 'BCNV1_SF2': 1200,
    'BCNV1_SF3':  528, 'BCNV2'    :  576, 'BCNV3'    :  972,
    'IRNV1_SF2': 1200, 'IRNV1_SF3':  548
}

#-------------------------------------------------------------------------------
#  Decode LDPC (Low Density Parity Check) codes and correct errors.
#
#  args:
#      type     (I) LDPC type
#                     'CNV2_SF2' : GPS/QZSS L1C-D CNAV-2 SF2
#                     'CNV2_SF3' : GPS/QZSS L1C-D CNAV-2 SF3
#                     'BCNV1_SF2': BDS B1C-D BCNAV-1 SF2
#                     'BCNV1_SF3': BDS B1C-D BCNAV-1 SF3
#                     'BCNV2'    : BDS B2a-D BCNAV-2
#                     'BCNV3'    : BDS B2b-D BCNAV-3
#                     'IRNV1_SF2': NavIC L1-SPS NAV SF2
#                     'IRNV1_SF3': NavIC L1-SPS NAV SF3
#      syms     (I) Codeword symbols as uint8 ndarray (0 or 1).
#
#  returns:
#      syms_dec Decoded symbols w/o parity as uint8 ndarray (0 or 1).
#               (len(syms_dec) = len(syms) / 2)
#      nerr     Number of corrected error bits (-1: unable to correct)
#
def decode_LDPC(type, syms):
    if len(syms) != CODE_LEN.get(type, 0):
        print('decode_LDPC: type or data length error (%s %d)' %
            (type, len(syms)))
        return NONE, -1

    # the library decoder takes soft symbols (0 to 255)
    soft = np.where(np.asarray(syms) != 0, 255, 0).astype('uint8')
    syms_dec = np.zeros(len(syms) // 2, dtype='uint8')
    p = soft.ctypes.data_as(POINTER(c_uint8))
    q = syms_dec.ctypes.data_as(POINTER(c_uint8))

    nerr = libsdr.sdr_decode_LDPC(type.encode(), p, len(syms), q)

    return syms_dec, nerr
